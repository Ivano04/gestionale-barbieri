import { expect, it, vi } from 'vitest';
import { runDailyOnce } from './worker';
import { dailyEmail } from './messages';
import type { DailyJob } from './types';
const config = { from: 'test@example.invalid', baseUrl: 'https://salon.example', secret: 'test-secret', reviewUrl: 'https://reviews.example/salon' };
const job: DailyJob = { id: 'daily-id', salon_id: 'salon', client_id: 'client', visit_date: '2026-10-28', type: 'reminder', state: 'running', lease_token: 'lease', first_attempt_at: null, attempts: 0, payload: null,
  context: { clientName: 'TEST', email: 'test@example.invalid', salonName: 'Salone', visitDate: '2026-10-28', firstStart: '2026-10-28T09:00:00Z', lastEnd: '2026-10-28T14:30:00Z', appointments: [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', startTime: '2026-10-28T09:00:00Z', endTime: '2026-10-28T09:30:00Z', status: 'confirmed', serviceName: 'Taglio', stylistName: 'Mario' },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', startTime: '2026-10-28T14:00:00Z', endTime: '2026-10-28T14:30:00Z', status: 'confirmed', serviceName: 'Colore', stylistName: 'Laura' },
  ] } };
function setup() {
  return { repo: { claim: vi.fn().mockResolvedValue(job), prepare: vi.fn().mockResolvedValue(job), authorize: vi.fn().mockResolvedValue(true), current: vi.fn().mockResolvedValue(true), finish: vi.fn(), block: vi.fn() }, sender: { send: vi.fn().mockResolvedValue('accepted') } };
}
it('sends one summary containing separate services, times, stylists and management links', async () => {
  const { repo, sender } = setup(); await runDailyOnce(repo, sender, config);
  expect(sender.send).toHaveBeenCalledTimes(1);
  const message = sender.send.mock.calls[0][0];
  expect(message.text).toContain('10:00–10:30 · Taglio · Mario');
  expect(message.text).toContain('15:00–15:30 · Colore · Laura');
  expect((message.html.match(/Modifica data e ora/g) ?? [])).toHaveLength(2);
  expect((message.html.match(/Annulla questa prenotazione/g) ?? [])).toHaveLength(2);
  expect(sender.send.mock.calls[0][1]).toBe('daily/reminder/daily-id');
  expect(repo.finish).toHaveBeenCalledWith(job, 'accepted');
});
it('sends one review for the visit rather than one per service', () => {
  const message = dailyEmail('review', job.context, config);
  expect((message.html.match(/Lascia una recensione/g) ?? [])).toHaveLength(1);
  expect(message.text).toContain('28 ottobre 2026');
});
it('uses Rome local time during DST rather than the machine timezone', () => {
  const context = { ...job.context, visitDate: '2026-07-28', appointments: [{ ...job.context.appointments[0], startTime: '2026-07-28T08:00:00Z', endTime: '2026-07-28T08:30:00Z' }] };
  expect(dailyEmail('reminder', context, config).text).toContain('10:00–10:30');
});
it('escapes customer, service and salon text and rejects unsafe review links', () => {
  const context = { ...job.context, clientName: '<script>x</script>', salonName: '<salon>', appointments: [{ ...job.context.appointments[0], serviceName: '<b>service</b>' }] };
  const message = dailyEmail('reminder', context, config);
  expect(message.html).not.toContain('<script>'); expect(message.html).toContain('&lt;b&gt;service&lt;/b&gt;');
  expect(() => dailyEmail('review', context, { ...config, reviewUrl: 'javascript:alert(1)' })).toThrow();
});
it('skips a day that was cancelled or marked absent before preparation', async () => {
  const { repo, sender } = setup(); repo.prepare.mockResolvedValue(null);
  await runDailyOnce(repo, sender, config); expect(sender.send).not.toHaveBeenCalled();
});
it('requires both snapshot authorization and a final attendance check', async () => {
  for (const failed of ['authorize', 'current'] as const) {
    const { repo, sender } = setup(); repo[failed].mockResolvedValue(false);
    await runDailyOnce(repo, sender, config); expect(sender.send).not.toHaveBeenCalled();
  }
});
it('reuses the stored sender, content and key after a timeout even if configuration changes', async () => {
  const { repo, sender } = setup(); const payload = dailyEmail(job.type, job.context, config);
  sender.send.mockRejectedValueOnce(new Error('timeout'));
  await runDailyOnce(repo, sender, config);
  repo.prepare.mockResolvedValue({ ...job, first_attempt_at: new Date().toISOString(), payload });
  await runDailyOnce(repo, sender, { ...config, from: 'changed@example.invalid', baseUrl: 'https://changed.example' });
  expect(sender.send.mock.calls[0]).toEqual(sender.send.mock.calls[1]);
  expect(repo.finish.mock.calls[0][1]).toBeNull(); expect(repo.finish.mock.calls[1][1]).toBe('accepted');
});
it('retains the lease if persistence fails after provider acceptance', async () => {
  const { repo, sender } = setup(); repo.finish.mockRejectedValue(new Error('checkpoint'));
  await expect(runDailyOnce(repo, sender, config)).rejects.toThrow('checkpoint');
  expect(repo.finish).toHaveBeenCalledTimes(1);
});
it('blocks an incomplete reminder configuration before attempting a send', async () => {
  const { repo, sender } = setup(); await runDailyOnce(repo, sender, { from: config.from });
  expect(sender.send).not.toHaveBeenCalled(); expect(repo.block).toHaveBeenCalledWith(job);
});

it('preserves the complete review URL including query parameters', () => {
  const reviewUrl = 'https://reviews.example/?destination=salon/';
  expect(dailyEmail('review', job.context, { ...config, reviewUrl }).text).toContain(reviewUrl);
});
