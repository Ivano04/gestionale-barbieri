import type { SupabaseClient } from '@supabase/supabase-js';
import { FiskalyTestClient, fiskalyTestConfigFromEnv } from './fiskaly-test-client';
export const FISCAL_BUCKET = 'fiscal-documents';
export function fiscalPdfPath(salonId: string, documentId: string, mode: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(salonId) || !uuid.test(documentId) || !['test', 'live'].includes(mode)) throw new Error('Invalid fiscal PDF path');
  return `${salonId}/${mode}/${documentId}.pdf`;
}
// PDF retrieval is separate from emission: failures never reissue a receipt.
export async function archiveFiscalTestPdfs(db: SupabaseClient): Promise<void> {
  const config = fiskalyTestConfigFromEnv();
  const { data: documents, error } = await db.from('fiscal_documents')
    .select('id,salon_id,mode,provider_record_id,configuration_snapshot,pdf_attempt_count')
    .eq('provider', 'fiskaly').eq('mode', 'test').eq('processing_status', 'completed')
    .is('pdf_storage_path', null).lte('pdf_next_attempt_at', new Date().toISOString())
    .order('pdf_next_attempt_at').limit(5);
  if (error) throw new Error('Fiscal PDF queue unavailable');
  for (const document of documents ?? []) {
    const attempts = document.pdf_attempt_count + 1;
    try {
      if (!document.provider_record_id || document.configuration_snapshot?.mode !== 'test') throw new Error('Invalid PDF configuration');
      const client = new FiskalyTestClient({ ...config, systemId: document.configuration_snapshot.system_id });
      await client.assertOrganization(document.configuration_snapshot.organization_id);
      const pdf = await client.getRecordPdf(document.provider_record_id);
      const path = fiscalPdfPath(document.salon_id, document.id, document.mode);
      const { error: uploadError } = await db.storage.from(FISCAL_BUCKET).upload(path, pdf,
        { contentType: 'application/pdf', upsert: true, cacheControl: '0' });
      if (uploadError) throw new Error('Fiscal PDF upload failed');
      const { error: saveError } = await db.from('fiscal_documents')
        .update({ pdf_storage_path: path, pdf_attempt_count: attempts, pdf_last_error: null })
        .eq('id', document.id).eq('salon_id', document.salon_id).is('pdf_storage_path', null);
      if (saveError) throw new Error('Fiscal PDF checkpoint failed');
    } catch {
      const delay = Math.min(3600, 30 * 2 ** Math.min(attempts, 6));
      const { error: retryError } = await db.from('fiscal_documents').update({ pdf_attempt_count: attempts,
        pdf_last_error: 'PDF_ARCHIVE_FAILED', pdf_next_attempt_at: new Date(Date.now() + delay * 1000).toISOString() })
        .eq('id', document.id).eq('salon_id', document.salon_id).is('pdf_storage_path', null);
      if (retryError) throw new Error('Fiscal PDF retry checkpoint failed');
    }
  }
}
