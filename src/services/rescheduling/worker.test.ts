import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: vi.fn(), send: vi.fn(), n8n: vi.fn(), ghl: vi.fn(), tw: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.db }));
vi.mock('@/services/notifications', () => ({ emailConfigFromEnv: () => ({ apiKey: 'fake' }), createEmailProvider: () => ({ send: mocks.send }) }));
vi.mock('@/lib/sync-webhook', () => ({ sendN8nEvent: mocks.n8n }));
vi.mock('@/services/ghl-sync/sync', () => ({ updateGHLAppointment: mocks.ghl }));
vi.mock('@/services/treatwell-sync/sync', () => ({ pushUpdateToTreatwell: mocks.tw }));
import { runRescheduleBatch } from './worker';
const id = '11111111-1111-4111-8111-111111111111';
const job = { id, appointment_id: id, salon_id: id, revision: 1, attempts: 1, lease_token: 'lease', new_start: '2026-11-02T10:00:00Z', new_end: '2026-11-02T10:30:00Z', payload: { email: 'test@example.invalid', clientName: 'TEST', serviceName: 'Taglio', salonName: 'TEST' } };
function repo(appointment: Record<string, unknown>, loseCheckpoint = false) {
  const patches: Record<string, unknown>[] = [];
  const chain = (result: unknown): Record<string, unknown> => { const c: Record<string, unknown> = {}; for (const method of ['eq','gt','select']) c[method] = () => c; c.single = async () => result; c.then = (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve); return c; };
  const rpc = vi.fn().mockResolvedValueOnce({ data: [job], error: null }).mockResolvedValue({ data: [], error: null });
  const db = { rpc, from: (table: string) => table === 'appointments' ? { select: () => chain({ data: appointment, error: null }) } : { update: (values: Record<string, unknown>) => { patches.push(values); return chain({ data: loseCheckpoint ? [] : [{ id }], error: null }); } } };
  mocks.db.mockReturnValue(db);
  return patches;
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('NEXT_PUBLIC_APP_URL','https://example.test'); vi.stubEnv('CRON_SECRET','secret'); mocks.send.mockResolvedValue({ id: 'mail-id' }); });
afterEach(() => vi.unstubAllEnvs());
it('sends a persistent-key confirmation and marks the event complete', async () => {
  const patches = repo({ status: 'confirmed', reschedule_version: 1, start_time: job.new_start });
  await runRescheduleBatch();
  expect(mocks.send.mock.calls[0][0].idempotencyKey).toBe('appointment-reschedule/' + id);
  expect(mocks.send.mock.calls[0][0].text).toContain('Modifica data e ora:');
  expect(patches[0]).toMatchObject({ state: 'done', provider_email_id: 'mail-id' });
});
it('does not send or sync an obsolete move after cancellation or a newer revision', async () => {
  const patches = repo({ status: 'cancelled', reschedule_version: 2, start_time: job.new_start });
  await runRescheduleBatch(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.n8n).not.toHaveBeenCalled(); expect(patches[0]).toMatchObject({ state: 'done', last_error_code: 'SUPERSEDED' });
});
it('keeps failed email delivery queued without moving the appointment again', async () => {
  mocks.send.mockRejectedValue(new Error('temporary failure'));
  const patches = repo({ status: 'confirmed', reschedule_version: 1, start_time: job.new_start });
  await runRescheduleBatch(); expect(patches[0]).toMatchObject({ state: 'pending', last_error_code: 'RESCHEDULE_NOTIFICATION_UNAVAILABLE' });
});
it('a lost checkpoint after email acceptance reuses the exact same key on retry', async () => {
  repo({ status: 'confirmed', reschedule_version: 1, start_time: job.new_start }, true);
  await expect(runRescheduleBatch()).rejects.toThrow('lease lost');
  repo({ status: 'confirmed', reschedule_version: 1, start_time: job.new_start });
  await runRescheduleBatch();
  expect(mocks.send.mock.calls[0][0]).toEqual(mocks.send.mock.calls[1][0]);
});
