import { createHash } from 'node:crypto';
import type { FiscalEmailPayload } from './email-template';
export interface FiscalEmailJob {
  id: string; salon_id: string; document_id: string; mode: string; recipient: string; payload: FiscalEmailPayload;
  pdf_path: string; pdf_sha256: string; idempotency_key: string; attempts: number; first_attempt_at: string; lease_token: string;
}
export interface FiscalEmailRepo {
  claim(): Promise<FiscalEmailJob | null>;
  download(path: string): Promise<Buffer>;
  checkpoint(job: FiscalEmailJob, state: 'sent' | 'retry' | 'uncertain' | 'failed', emailId?: string, errorCode?: string): Promise<void>;
}
export interface FiscalEmailSender { send(payload: FiscalEmailPayload, pdf: Buffer, key: string, filename: string): Promise<string> }
export class FiscalEmailSendError extends Error {
  constructor(public readonly retryable: boolean, public readonly code: string) { super(code); }
}
export async function runFiscalEmailOnce(repo: FiscalEmailRepo, sender: FiscalEmailSender, authorizedTo: string, now = Date.now()): Promise<'idle' | 'processed'> {
  const job = await repo.claim();
  if (!job) return 'idle';
  if (!Number.isFinite(Date.parse(job.first_attempt_at)) || now - Date.parse(job.first_attempt_at) >= 23 * 3600000) {
    await repo.checkpoint(job, 'uncertain', undefined, 'IDEMPOTENCY_WINDOW_EXPIRED'); return 'processed';
  }
  if (job.mode !== 'test' || job.recipient !== authorizedTo || job.payload.to !== authorizedTo ||
      job.pdf_path !== `${job.salon_id}/test/${job.document_id}.pdf`) {
    await repo.checkpoint(job, 'failed', undefined, 'EMAIL_TEST_SCOPE_MISMATCH'); return 'processed';
  }
  let emailId: string;
  try {
    const pdf = await repo.download(job.pdf_path);
    if (pdf.subarray(0, 5).toString() !== '%PDF-' || createHash('sha256').update(pdf).digest('hex') !== job.pdf_sha256) {
      await repo.checkpoint(job, 'failed', undefined, 'EMAIL_PDF_CHANGED'); return 'processed';
    }
    emailId = await sender.send(job.payload, pdf, 'fiscal-test/' + job.idempotency_key, `ricevuta-test-${job.document_id}.pdf`);
    if (!emailId) throw new FiscalEmailSendError(true, 'EMAIL_RESPONSE_UNCERTAIN');
  } catch (error) {
    await repo.checkpoint(job, error instanceof FiscalEmailSendError && !error.retryable ? 'failed' : 'retry',
      undefined, error instanceof FiscalEmailSendError ? error.code : 'EMAIL_TEMPORARY_ERROR');
    return 'processed';
  }
  // If persistence fails after acceptance, let the lease expire: same key and payload on recovery.
  await repo.checkpoint(job, 'sent', emailId);
  return 'processed';
}
