import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const provider = vi.hoisted(() => ({ assertOrganization: vi.fn(), getRecordPdf: vi.fn() }));
vi.mock('./fiskaly-test-client', () => ({
  fiskalyTestConfigFromEnv: () => ({}),
  FiskalyTestClient: class { assertOrganization = provider.assertOrganization; getRecordPdf = provider.getRecordPdf; },
}));
import { archiveFiscalTestPdfs, fiscalPdfPath } from './pdf-storage';
const salon = '11111111-1111-1111-1111-111111111111';
const id = '22222222-2222-2222-2222-222222222222';
function database(uploadFails = false) {
  const updates: Record<string, unknown>[] = [];
  const upload = vi.fn(async () => ({ error: uploadFails ? {} : null }));
  const query = {
    select: () => query, eq: () => query, is: () => query, lte: () => query, order: () => query,
    limit: async () => ({ data: [{ id, salon_id: salon, mode: 'test', provider_record_id: 'record',
      configuration_snapshot: { mode: 'test', organization_id: 'organization', system_id: 'system' }, pdf_attempt_count: 0 }], error: null }),
    update: (data: Record<string, unknown>) => { updates.push(data); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  return { db: { from: () => query, storage: { from: () => ({ upload }) } } as unknown as SupabaseClient, updates, upload };
}
beforeEach(() => { vi.clearAllMocks(); provider.getRecordPdf.mockResolvedValue(Buffer.from('%PDF-TEST')); });
describe('private fiscal PDF archive', () => {
  it('uses a deterministic path scoped to salon and environment', () => {
    expect(fiscalPdfPath(salon, id, 'test')).toBe(`${salon}/test/${id}.pdf`);
    expect(() => fiscalPdfPath('../other', id, 'test')).toThrow();
    expect(() => fiscalPdfPath(salon, id, '../live')).toThrow();
  });
  it('stores the verified PDF and persists availability', async () => {
    const fake = database(); await archiveFiscalTestPdfs(fake.db);
    expect(provider.assertOrganization).toHaveBeenCalledWith('organization');
    expect(fake.upload).toHaveBeenCalledWith(`${salon}/test/${id}.pdf`, expect.any(Buffer), expect.objectContaining({ contentType: 'application/pdf', upsert: true }));
    expect(fake.updates[0]).toMatchObject({ pdf_storage_path: `${salon}/test/${id}.pdf`, pdf_last_error: null });
  });
  it('persists retry without marking the PDF available when storage fails', async () => {
    const fake = database(true); await archiveFiscalTestPdfs(fake.db);
    expect(fake.updates[0]).toMatchObject({ pdf_last_error: 'PDF_ARCHIVE_FAILED', pdf_attempt_count: 1 });
    expect(fake.updates[0]).not.toHaveProperty('pdf_storage_path');
    expect(new Date(fake.updates[0].pdf_next_attempt_at as string).getTime()).toBeGreaterThan(Date.now());
  });
});
