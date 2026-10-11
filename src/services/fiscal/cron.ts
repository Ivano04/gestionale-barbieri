import { runRefundTestBatch } from '@/services/payments/refund-cron';
import { sendFiscalTestEmails } from './email-cron';
import { archiveFiscalTestPdfs } from './pdf-storage';
import { createAdminClient } from '@/lib/supabase/admin';
import { FiskalyTestClient, fiskalyTestConfigFromEnv } from './fiskaly-test-client';
import { createFiscalWorkerRepo } from './worker-repo';
import { runFiscalWorkerOnce } from './worker';

let running = false;
export async function runFiscalTestBatch(): Promise<void> {
  if (process.env.FISKALY_TEST_ENABLED !== 'true') return;
  const config = fiskalyTestConfigFromEnv();
  if (process.env.NEXI_ENV !== 'test') throw new Error('Fiscal worker requires Nexi TEST');
  if (running) return;
  running = true;
  try {
    await runRefundTestBatch(createAdminClient());
    const repo = createFiscalWorkerRepo(createAdminClient());
    for (let i = 0; i < 5; i++) {
      const outcome = await runFiscalWorkerOnce(repo, work =>
        new FiskalyTestClient({ ...config, systemId: work.configuration.system_id }));
      if (outcome === 'idle') break;
    }
    await archiveFiscalTestPdfs(createAdminClient());
    await sendFiscalTestEmails(createAdminClient());
  } finally { running = false; }
}
export function startFiscalTestCron(): void {
  if (process.env.FISKALY_TEST_ENABLED !== 'true') return;
  const tick = () => { void runFiscalTestBatch().catch(() => console.error('[fiscal] Worker unavailable; persistent jobs retained')); };
  setTimeout(tick, 10_000);
  setInterval(tick, 30_000);
}
