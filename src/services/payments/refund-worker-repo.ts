import type { SupabaseClient } from '@supabase/supabase-js';
import type { RefundRepo, RefundJob } from './refund-worker';
export function refundWorkerRepo(db: SupabaseClient): RefundRepo {
 return {
  async claim() { const { data, error } = await db.rpc('claim_refund_test_job');if(error) throw new Error('Refund claim failed');return data?.[0] as RefundJob ?? null; },
  async start(job) { const { data, error } = await db.rpc('start_refund_test_call', { p_id:job.id,p_token:job.lease_token });if(error) throw new Error('Refund start checkpoint failed');return data===true; },
  async finish(job,outcome,operationId,errorCode) {
   const { data,error }=await db.rpc('finish_refund_test_job',{p_id:job.id,p_token:job.lease_token,p_outcome:outcome,p_operation:operationId??null,p_error:errorCode??null});
   if(error||data!==true) throw new Error('Refund outcome checkpoint failed');
  },
 };
}
