import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn(), eq: vi.fn(), select: vi.fn(), client: true, error: false }));
vi.mock('@/services/fiscal/staff-access', () => ({ fiscalStaffAccess: m.access }));
import { GET } from '@/app/api/clients/[id]/notifications/route';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const params = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks(); m.client = true; m.error = false;
  m.from.mockImplementation(() => {
    const q = { select: (fields: string) => { m.select(fields); return q; }, eq: (key: string, value: string) => { m.eq(key, value); return q; }, order: () => q,
      maybeSingle: async () => ({ data: m.client ? { id } : null, error: null }), limit: async () => ({ data: [], error: m.error ? {} : null }) };
    return q;
  });
  m.access.mockResolvedValue({ salonId: 'real-salon', db: { from: m.from } });
});
it('requires a staff session', async () => {
  m.access.mockResolvedValue({ response: new Response(null, { status: 401 }) });
  expect((await GET(new Request('https://test.invalid'), params)).status).toBe(401); expect(m.from).not.toHaveBeenCalled();
});
it('scopes the history to the salon and excludes signed payloads', async () => {
  const response = await GET(new Request('https://test.invalid'), params);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  expect(m.eq).toHaveBeenCalledWith('salon_id', 'real-salon');
  expect(m.select.mock.calls.flat().join(',')).not.toMatch(/payload|context|recipient/);
});
it('does not expose another salon customer history', async () => {
  m.client = false; expect((await GET(new Request('https://test.invalid'), params)).status).toBe(404);
  expect(m.from).not.toHaveBeenCalledWith('daily_notifications');
});
it('reports database failure rather than showing an empty successful history', async () => {
  m.error = true; expect((await GET(new Request('https://test.invalid'), params)).status).toBe(503);
});
