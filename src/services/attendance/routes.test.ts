import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn() }));
vi.mock('@/services/fiscal/staff-access', () => ({ fiscalStaffAccess: m.access }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: m.rpc }) }));
import { GET, POST } from '@/app/api/appointments/[id]/no-show/route';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const params = { params: Promise.resolve({ id }) };
const command = { requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', action: 'mark', ids: [id], expected: [{ id, updatedAt: '2026-10-24T14:00:00.123456Z' }] };
const post = (body: unknown) => POST(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify(body) }), params);
beforeEach(() => {
  vi.clearAllMocks(); m.access.mockResolvedValue({ salonId: 'authorized-salon', userId: 'real-staff' });
  m.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});
it('requires authentication for both reading and changing attendance', async () => {
  m.access.mockResolvedValue({ response: new Response(null, { status: 401 }) });
  expect((await GET(new Request('https://test.invalid'), params)).status).toBe(401);
  expect((await post(command)).status).toBe(401); expect(m.rpc).not.toHaveBeenCalled();
});
it('uses the authenticated salon and staff member instead of posted identity', async () => {
  expect((await post({ ...command, salonId: 'other', actorId: 'other' })).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith('change_no_show', {
    p_salon: 'authorized-salon', p_actor: 'real-staff', p_input: { ...command, appointmentId: id },
  });
});
it('returns a conflict for a running sequence or stale card', async () => {
  for (const message of ['VISIT_NOT_FINISHED', 'STALE_VISIT']) {
    m.rpc.mockResolvedValue({ data: null, error: { message } });
    expect((await post(command)).status).toBe(409);
  }
});
it('does not leak appointment data from another salon', async () => {
  m.rpc.mockResolvedValue({ data: null, error: null });
  expect((await GET(new Request('https://test.invalid'), params)).status).toBe(404);
  expect(m.rpc).toHaveBeenCalledWith('no_show_context', { p_salon: 'authorized-salon', p_id: id });
});
it('keeps an uncertain failure retryable with the same command', async () => {
  m.rpc.mockResolvedValue({ data: null, error: { message: 'temporary database failure' } });
  expect((await post(command)).status).toBe(503);
});
