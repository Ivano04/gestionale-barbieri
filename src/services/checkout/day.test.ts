import { beforeEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]>, fail: '', calls: [] as { table: string; filters: [string, unknown][] }[] }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from(table: string) {
  const call = { table, filters: [] as [string, unknown][] }; m.calls.push(call);
  const q = {
    select: () => q, order: () => q, limit: () => q,
    eq: (key: string, value: unknown) => { call.filters.push([key, value]); return q; },
    in: (key: string, value: unknown) => { call.filters.push([key, value]); return q; },
    is: (key: string, value: unknown) => { call.filters.push([key, value]); return q; },
    gte: (key: string, value: unknown) => { call.filters.push(['gte:' + key, value]); return q; },
    lt: (key: string, value: unknown) => { call.filters.push(['lt:' + key, value]); return q; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: m.rows[table] ?? [], error: table === m.fail ? { message: 'private' } : null }).then(resolve),
  }; return q;
} }) }));
import { checkoutDay } from './day';
const context = { snapshotBase: { clientId: 'client' }, appointment: { startTime: '2026-10-24T22:30:00Z' } } as Parameters<typeof checkoutDay>[1];
const appointment = (id: string) => ({ id, updated_at: '2026-10-20T08:00:00Z', start_time: context.appointment.startTime, status: 'confirmed', service: { id: 'service', name: 'Taglio', price_cents: 2800 }, stylist: { full_name: 'Stylist' }, added_services: [] });
beforeEach(() => { m.rows = {}; m.calls = []; m.fail = ''; });
it('uses the owning salon, exact client and whole Rome day including DST', async () => {
  m.rows.appointments = [appointment('a')];
  await checkoutDay('salon', context);
  expect(m.calls[0].filters).toEqual(expect.arrayContaining([['salon_id', 'salon'], ['client_id', 'client'], ['gte:start_time', '2026-10-24T22:00:00.000Z'], ['lt:start_time', '2026-10-25T23:00:00.000Z']]));
  for (const call of m.calls) expect(call.filters).toContainEqual(['salon_id', 'salon']);
});
it('shows but disables paid, pending, canceled and already documented appointments', async () => {
  m.rows.appointments = ['unpaid', 'online', 'pending', 'grouped', 'document', 'closed'].map(appointment);
  m.rows.appointments[5] = { ...appointment('closed'), status: 'cancelled' };
  m.rows.payments = [{ appointment_id: 'online', status: 'succeeded' }, { appointment_id: 'pending', status: 'pending' }];
  m.rows.salon_sale_appointments = [{ appointment_id: 'grouped' }];
  m.rows.fiscal_documents = [{ appointment_id: 'document' }];
  const choices = await checkoutDay('salon', context);
  expect(choices.map(a => a.canCollect)).toEqual([true, false, false, false, false, false]);
  expect(choices.slice(1).every(a => !!a.reason)).toBe(true);
});
it('includes additional services and keeps their appointment linkage', async () => {
  m.rows.appointments = [{ ...appointment('a'), added_services: [{ service_id: 'extra' }] }];
  m.rows.services = [{ id: 'extra', name: 'Barba', price_cents: 1000 }];
  const [a] = await checkoutDay('salon', context);
  expect(a.lines.map(l => [l.id, l.unitPriceCents, l.appointmentId])).toEqual([['service', 2800, 'a'], ['extra', 1000, 'a']]);
});
it('fails closed when payment reads are incomplete and never groups anonymous customers', async () => {
  m.rows.appointments = [appointment('a')]; m.fail = 'payments';
  await expect(checkoutDay('salon', context)).rejects.toThrow();
  m.calls = [];
  expect(await checkoutDay('salon', { ...context, snapshotBase: { ...context.snapshotBase, clientId: null } })).toEqual([]);
  expect(m.calls).toHaveLength(0);
});
