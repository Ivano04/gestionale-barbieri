import type { SupabaseClient } from '@supabase/supabase-js';
import { FISCAL_BUCKET } from './pdf-storage';
import type { FiscalEmailJob, FiscalEmailRepo } from './email-worker';
export function fiscalEmailRepo(db: SupabaseClient): FiscalEmailRepo {
  return {
    async claim() {
      const { data, error } = await db.rpc('claim_fiscal_email_job');
      if (error) throw new Error('Fiscal email claim failed');
      return data?.[0] as FiscalEmailJob ?? null;
    },
    async download(path) {
      const { data, error } = await db.storage.from(FISCAL_BUCKET).download(path);
      if (error || !data) throw new Error('Fiscal email PDF unavailable');
      return Buffer.from(await data.arrayBuffer());
    },
    async checkpoint(job, state, emailId, errorCode) {
      const { data, error } = await db.rpc('checkpoint_fiscal_email_job', { p_id: job.id, p_token: job.lease_token,
        p_state: state, p_provider_id: emailId ?? null, p_error: errorCode ?? null,
        p_delay: Math.min(3600, 30 * 2 ** Math.min(job.attempts, 6)) });
      if (error || data !== true) throw new Error('Fiscal email checkpoint failed');
    },
  };
}
