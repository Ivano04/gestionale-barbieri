import type { SupabaseClient } from '@supabase/supabase-js';
import { FiscalLeaseLost, type FiscalWorkerRepo, type FiscalWork } from './worker';

export function createFiscalWorkerRepo(db: SupabaseClient): FiscalWorkerRepo {
  return {
    async claim() {
      const { data: jobs, error } = await db.rpc('claim_fiscal_job', { p_lease_seconds: 120 });
      if (error) throw new Error('Fiscal job claim failed');
      const job = jobs?.[0];
      if (!job) return null;
      const { data: document, error: readError } = await db.from('fiscal_documents')
        .select('*').eq('id', job.document_id).eq('salon_id', job.salon_id).single();
      if (readError || !document) throw new Error('Fiscal document read failed');
      let originalRecordId: string | undefined;
      if (document.operation === 'cancellation') {
        const { data: original, error: originalError } = await db.from('fiscal_documents')
          .select('provider_record_id,processing_status').eq('id', document.original_document_id)
          .eq('salon_id', document.salon_id).eq('mode', document.mode).eq('provider', document.provider).single();
        if (originalError || original?.processing_status !== 'completed' || !original?.provider_record_id ||
            document.operation_snapshot?.record?.id !== original.provider_record_id) throw new Error('Original fiscal record mismatch');
        originalRecordId = original.provider_record_id;
      }
      return {
        originalRecordId,
        jobId: job.id, leaseToken: job.lease_token, attempts: job.attempts, documentId: document.id,
        salonId: job.salon_id, operation: document.operation, mode: document.mode,
        snapshot: document.operation_snapshot, configuration: document.configuration_snapshot,
        intentionKey: document.intention_key, transactionKey: document.transaction_key,
        intentionId: document.provider_intention_id ?? undefined, recordId: document.provider_record_id ?? undefined,
      } as FiscalWork;
    },
    async checkpoint(work, progress) {
      const { data, error } = await db.rpc('checkpoint_fiscal_job', {
        p_job_id: work.jobId, p_token: work.leaseToken, p_outcome: progress.outcome,
        p_intention: progress.intentionId ?? null, p_record: progress.recordId ?? null,
        p_state: progress.state ?? null, p_mode: progress.mode ?? null,
        p_error: progress.errorCode ?? null, p_delay: progress.delaySeconds ?? 30,
      });
      if (error) throw new Error('Fiscal checkpoint failed');
      if (data !== true) throw new FiscalLeaseLost('Fiscal lease expired');
    },
  };
}
