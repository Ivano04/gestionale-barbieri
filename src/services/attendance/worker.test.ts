import { describe, expect, it, vi } from 'vitest';
import { runNoShowEmailOnce, type NoShowEmailJob, type NoShowEmailRepo } from './worker';
import { noShowEmail } from './email';
const now = Date.parse('2026-10-24T15:00:00Z');
const job: NoShowEmailJob = {
  id: 'daily-job', salon_id: 'salon', client_id: 'client', visit_date: '2026-10-24', lease_token: 'lease',
  recipient: 'test@example.invalid', payload: { clientName: 'Mario', salonName: 'TEST', salonPhone: null, visitDate: '2026-10-24' },
  attempts: 1, first_attempt_at: new Date(now).toISOString(),
};
function setup(overrides: Partial<NoShowEmailJob> = {}) {
  const current = { ...job, ...overrides };
  const repo = {
    claim: vi.fn().mockResolvedValue(current), prepare: vi.fn().mockResolvedValue(current),
    current: vi.fn().mockResolvedValue(true), checkpoint: vi.fn().mockResolvedValue(undefined),
  } satisfies NoShowEmailRepo;
  return { repo, provider: { send: vi.fn().mockResolvedValue({ id: 'resend-id' }) } };
}
describe('no-show email delivery', () => {
  it('sends one daily message with a stable provider key', async () => {
    const { repo, provider } = setup();
    await runNoShowEmailOnce(repo, provider, job.recipient, now);
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ to: job.recipient, idempotencyKey: 'no-show/daily-job' }));
    expect(repo.checkpoint).toHaveBeenCalledWith(job, expect.objectContaining({ state: 'sent', provider_email_id: 'resend-id' }));
  });
  it('does not send when restoration cancels preparation', async () => {
    const { repo, provider } = setup(); repo.prepare.mockResolvedValue(null);
    await runNoShowEmailOnce(repo, provider, job.recipient, now);
    expect(provider.send).not.toHaveBeenCalled();
  });
  it('rechecks restoration or a lost lease immediately before sending', async () => {
    const { repo, provider } = setup(); repo.current.mockResolvedValue(false);
    await runNoShowEmailOnce(repo, provider, job.recipient, now);
    expect(provider.send).not.toHaveBeenCalled(); expect(repo.checkpoint).not.toHaveBeenCalled();
  });
  it('does not redirect customers to the TEST address', async () => {
    const { repo, provider } = setup({ recipient: 'other@example.invalid' });
    await runNoShowEmailOnce(repo, provider, job.recipient, now);
    expect(provider.send).not.toHaveBeenCalled();
    expect(repo.checkpoint).toHaveBeenCalledWith(expect.anything(), { state: 'blocked', last_error_code: 'EMAIL_TEST_RECIPIENT_REQUIRED' });
  });
  it('uses the identical message and key after a timeout', async () => {
    const { repo, provider } = setup(); provider.send.mockRejectedValueOnce(new Error('timeout'));
    await runNoShowEmailOnce(repo, provider, job.recipient, now);
    await runNoShowEmailOnce(repo, provider, job.recipient, now + 120000);
    expect(provider.send.mock.calls[0]).toEqual(provider.send.mock.calls[1]);
    expect(repo.checkpoint.mock.calls[0][1]).toMatchObject({ state: 'pending' });
    expect(repo.checkpoint.mock.calls[1][1]).toMatchObject({ state: 'sent' });
  });
  it('lets a failed checkpoint recover using the same provider key', async () => {
    const { repo, provider } = setup(); repo.checkpoint.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(runNoShowEmailOnce(repo, provider, job.recipient, now)).rejects.toThrow('database unavailable');
    await runNoShowEmailOnce(repo, provider, job.recipient, now);
    expect(provider.send.mock.calls[0]).toEqual(provider.send.mock.calls[1]);
  });
  it('stops uncertain requests before provider idempotency expires', async () => {
    const { repo, provider } = setup({ first_attempt_at: new Date(now - 23 * 3600000).toISOString() });
    await runNoShowEmailOnce(repo, provider, job.recipient, now);
    expect(provider.send).not.toHaveBeenCalled(); expect(repo.checkpoint.mock.calls[0][1].state).toBe('uncertain');
  });
  it('stops repeated failures for reconciliation', async () => {
    const { repo, provider } = setup({ attempts: 5 }); provider.send.mockRejectedValue(new Error('timeout'));
    await runNoShowEmailOnce(repo, provider, job.recipient, now);
    expect(repo.checkpoint.mock.calls[0][1].state).toBe('uncertain');
  });
  it('escapes customer and salon details without mentioning debts or penalties', () => {
    const email = noShowEmail({ ...job.payload, clientName: '<script>test</script>', salonName: '<TEST>', salonPhone: '123 & 456' });
    expect(email.html).not.toContain('<script>'); expect(email.html).toContain('&lt;TEST&gt;');
    expect(email.text).toContain('24 ottobre 2026'); expect(email.text).not.toMatch(/penal|debito|pagamento/i);
  });
});
