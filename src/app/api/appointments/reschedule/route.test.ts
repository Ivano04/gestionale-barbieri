import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeRescheduleToken } from '@/services/rescheduling/token';
const mocks = vi.hoisted(() => ({ load: vi.fn(), slots: vi.fn(), move: vi.fn() }));
vi.mock('@/services/rescheduling/service', () => ({ loadReschedulableAppointment: mocks.load, rescheduleSlots: mocks.slots, moveClientAppointment: mocks.move }));
import { GET, POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const token = makeRescheduleToken(id, 'secret');
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('CRON_SECRET', 'secret'); mocks.load.mockResolvedValue({ id, status: 'confirmed', start_time: new Date(Date.now() + 86400000).toISOString(), service_id: id, stylist_id: id, service: { name: 'Taglio' }, salon: { name: 'TEST' }, stylist: { full_name: 'Operatore' } }); mocks.slots.mockResolvedValue([]); });
afterEach(() => vi.unstubAllEnvs());
it('rejects forged links without accessing the database', async () => {
  const r = await GET(new NextRequest('http://localhost/api/appointments/reschedule?token=invalid'));
  expect(r.status).toBe(400); expect(mocks.load).not.toHaveBeenCalled();
});
it('does not reveal availability for a cancelled booking and disables caching', async () => {
  mocks.load.mockResolvedValue({ id, status: 'cancelled', start_time: '2026-10-12T09:00:00Z' });
  const r = await GET(new NextRequest('http://localhost/api/appointments/reschedule?token=' + token));
  expect(r.status).toBe(200); expect((await r.json()).canModify).toBe(false); expect(mocks.slots).not.toHaveBeenCalled(); expect(r.headers.get('cache-control')).toContain('no-store');
});
it('validates mutation fields before reading a booking', async () => {
  const r = await POST(new NextRequest('http://localhost/api/appointments/reschedule', { method: 'POST', body: JSON.stringify({ token, date: '2027-02-30' }) }));
  expect(r.status).toBe(400); expect(mocks.load).not.toHaveBeenCalled();
});
it('binds changes to the signed appointment and returns a concurrent conflict', async () => {
  mocks.move.mockResolvedValue({ ok: false, reason: 'stale' });
  const r = await POST(new NextRequest('http://localhost/api/appointments/reschedule', { method: 'POST', body: JSON.stringify({ token, appointment_id: 'another', date: '2026-11-02', time: '11:00', requestId: id, expectedStart: '2026-10-12T09:00:00Z' }) }));
  expect(r.status).toBe(409); expect(mocks.load).toHaveBeenCalledWith(id); expect(mocks.move).toHaveBeenCalledOnce();
});
