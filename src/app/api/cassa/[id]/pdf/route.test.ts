import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), admin: vi.fn(), download: vi.fn() }));
vi.mock('@/services/fiscal/staff-access', () => ({ fiscalStaffAccess: mocks.access }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
import { GET } from './route';
const salon = '11111111-1111-1111-1111-111111111111';
const id = '22222222-2222-2222-2222-222222222222';
function access(document: unknown) {
  const eq = vi.fn(() => query);
  const query = { select: () => query, eq, maybeSingle: async () => ({ data: document, error: null }) };
  mocks.access.mockResolvedValue({ salonId: salon, db: { from: () => query } });
  return eq;
}
const request = () => GET(new Request('http://localhost/api/cassa/' + id + '/pdf'), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockReturnValue({ storage: { from: () => ({ download: mocks.download }) } });
  mocks.download.mockResolvedValue({ data: new Blob(['%PDF-TEST']), error: null });
});
describe('authorized fiscal PDF download', () => {
  it('denies anonymous callers before reading storage', async () => {
    mocks.access.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    expect((await request()).status).toBe(401); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('denies a document outside the user salon without accessing storage', async () => {
    const eq = access(null);
    expect((await request()).status).toBe(404);
    expect(eq).toHaveBeenCalledWith('salon_id', salon); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('rejects a stored path pointing to another salon', async () => {
    access({ id, salon_id: salon, mode: 'test', processing_status: 'completed', pdf_storage_path: 'other/test/' + id + '.pdf' });
    expect((await request()).status).toBe(409); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('downloads only the authorized canonical path with private cache headers', async () => {
    access({ id, salon_id: salon, mode: 'test', processing_status: 'completed', pdf_storage_path: `${salon}/test/${id}.pdf` });
    const response = await request(); expect(response.status).toBe(200);
    expect(mocks.download).toHaveBeenCalledWith(`${salon}/test/${id}.pdf`);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe('%PDF-TEST');
  });
});
