import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { fiscalTestEmailConfig, type FiscalTestEmailConfig } from './email-config';
import { fiscalTestEmailPayload } from './email-template';
import { FISCAL_BUCKET, fiscalPdfPath } from './pdf-storage';
import { fiscalEmailRepo } from './email-repo';
import { runFiscalEmailOnce } from './email-worker';
import { fiscalResendSender } from './email-resend';
export async function enqueueFiscalTestEmails(db: SupabaseClient, config: FiscalTestEmailConfig): Promise<void> {
  const { data: documents, error } = await db.from('fiscal_documents')
    .select('id,salon_id,mode,operation,pdf_storage_path,amount_cents,operation_snapshot,salon:salons(name),email_jobs:fiscal_email_jobs(id)')
    .eq('provider', 'fiskaly').eq('mode', 'test').eq('processing_status', 'completed')
    .not('pdf_storage_path', 'is', null).is('email_jobs', null).order('created_at').limit(5);
  if (error) throw new Error('Fiscal email queue unavailable');
  for (const document of documents ?? []) {
    if (document.pdf_storage_path !== fiscalPdfPath(document.salon_id, document.id, document.mode)) throw new Error('Invalid fiscal PDF path');
    const { data: pdf, error: pdfError } = await db.storage.from(FISCAL_BUCKET).download(document.pdf_storage_path);
    if (pdfError || !pdf) throw new Error('Fiscal email attachment unavailable');
    const bytes = Buffer.from(await pdf.arrayBuffer());
    const salon = Array.isArray(document.salon) ? document.salon[0] : document.salon;
    const payload = fiscalTestEmailPayload({ from: config.from, to: config.to, salonName: salon?.name ?? 'Salone TEST',
      number: document.operation_snapshot?.document?.number ?? document.id, amountCents: document.amount_cents, operation: document.operation });
    const { error: insertError } = await db.from('fiscal_email_jobs').upsert({ salon_id: document.salon_id,
      document_id: document.id, mode: 'test', recipient: config.to, payload, pdf_path: document.pdf_storage_path,
      pdf_sha256: createHash('sha256').update(bytes).digest('hex') }, { onConflict: 'document_id', ignoreDuplicates: true });
    if (insertError) throw new Error('Fiscal email enqueue failed');
  }
}
export async function sendFiscalTestEmails(db: SupabaseClient): Promise<void> {
  const config = fiscalTestEmailConfig();
  if (!config) return;
  await enqueueFiscalTestEmails(db, config);
  const repo = fiscalEmailRepo(db); const sender = fiscalResendSender(new Resend(config.apiKey));
  for (let i = 0; i < 5; i++) if (await runFiscalEmailOnce(repo, sender, config.to) === 'idle') break;
}
