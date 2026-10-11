export interface RefundJob { id: string; lease_token: string; mode: string; provider: string; provider_ref: string; amount_cents: number }
export interface RefundRepo { claim(): Promise<RefundJob | null>; start(job: RefundJob): Promise<boolean>;
 finish(job: RefundJob, outcome: 'accepted' | 'failed' | 'uncertain', operationId?: string, errorCode?: string): Promise<void> }
export interface VerifiedRefundProvider { refundWithResult(ref: string, amount: number): Promise<{ operationId: string }> }
export class RefundRejected extends Error {}
export async function runRefundOnce(repo: RefundRepo, provider: VerifiedRefundProvider): Promise<'idle' | 'processed'> {
 const job = await repo.claim(); if (!job) return 'idle';
 if (job.mode !== 'test' || job.provider !== 'nexi' || !job.provider_ref || !Number.isSafeInteger(job.amount_cents) || job.amount_cents <= 0) {
  await repo.finish(job, 'failed', undefined, 'INVALID_TEST_REFUND');return 'processed';
 }
 if (!await repo.start(job)) return 'processed';
 let operationId: string;
 try { operationId = (await provider.refundWithResult(job.provider_ref, job.amount_cents)).operationId;
  if (!operationId) throw new Error('Unverified refund');
 } catch (error) {
  await repo.finish(job, error instanceof RefundRejected ? 'failed' : 'uncertain', undefined,
    error instanceof RefundRejected ? 'NEXI_REFUND_REJECTED' : 'REFUND_RESPONSE_UNCERTAIN');return 'processed';
 }
 await repo.finish(job, 'accepted', operationId);
 return 'processed';
}
