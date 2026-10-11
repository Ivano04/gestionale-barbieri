import type { SupabaseClient } from '@supabase/supabase-js';
import { NexiProvider } from './nexi';
import { paymentConfigFromEnv } from './index';
import { runRefundOnce } from './refund-worker';
import { refundWorkerRepo } from './refund-worker-repo';
export async function runRefundTestBatch(db: SupabaseClient): Promise<void> {
 if(process.env.FISKALY_TEST_REFUNDS_ENABLED!=='true') return;
 const config=paymentConfigFromEnv();
 if(config.provider!=='nexi'||config.nexiEnv!=='test'||!config.nexiAlias||!config.nexiMacKey||process.env.FISKALY_ENV!=='test') throw new Error('Refunds require Nexi TEST');
 const provider=new NexiProvider({alias:config.nexiAlias,macKey:config.nexiMacKey,env:'test'});
 const repo=refundWorkerRepo(db);
 for(let i=0;i<5;i++) if(await runRefundOnce(repo,provider)==='idle') break;
 const {error}=await db.rpc('enqueue_refunded_fiscal_cancellations');if(error) throw new Error('Fiscal cancellation enqueue failed');
}
