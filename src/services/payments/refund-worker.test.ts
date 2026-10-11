import { describe, expect, it, vi } from 'vitest';
import { runRefundOnce, RefundRejected, type RefundJob } from './refund-worker';
const job: RefundJob = { id:'job',lease_token:'lease',mode:'test',provider:'nexi',provider_ref:'ref',amount_cents:2440 };
function setup() { return { repo:{ claim:vi.fn().mockResolvedValue(job),start:vi.fn().mockResolvedValue(true),finish:vi.fn().mockResolvedValue(undefined) },provider:{refundWithResult:vi.fn().mockResolvedValue({operationId:'op'})} }; }
describe('persistent refund worker',()=>{
 it('records call intent before Nexi and only then commits verified success',async()=>{
  const {repo,provider}=setup();await runRefundOnce(repo,provider);
  expect(repo.start.mock.invocationCallOrder[0]).toBeLessThan(provider.refundWithResult.mock.invocationCallOrder[0]);
  expect(repo.finish).toHaveBeenCalledWith(job,'accepted','op');
 });
 it('records timeouts as uncertain without automatic refund retry',async()=>{
  const {repo,provider}=setup();provider.refundWithResult.mockRejectedValue(new Error('timeout'));
  await runRefundOnce(repo,provider);expect(repo.finish).toHaveBeenCalledWith(job,'uncertain',undefined,'REFUND_RESPONSE_UNCERTAIN');
 });
 it('records signed rejections as failed',async()=>{
  const {repo,provider}=setup();provider.refundWithResult.mockRejectedValue(new RefundRejected('KO'));
  await runRefundOnce(repo,provider);expect(repo.finish).toHaveBeenCalledWith(job,'failed',undefined,'NEXI_REFUND_REJECTED');
 });
 it('does not call Nexi when lease ownership is lost',async()=>{
  const {repo,provider}=setup();repo.start.mockResolvedValue(false);await runRefundOnce(repo,provider);expect(provider.refundWithResult).not.toHaveBeenCalled();
 });
 it('does not overwrite acceptance with failure if DB is unavailable',async()=>{
  const {repo,provider}=setup();repo.finish.mockRejectedValue(new Error('DB unavailable'));
  await expect(runRefundOnce(repo,provider)).rejects.toThrow('DB unavailable');expect(repo.finish).toHaveBeenCalledTimes(1);
 });
 it('rejects LIVE before an external refund',async()=>{
  const {repo,provider}=setup();repo.claim.mockResolvedValue({...job,mode:'live'});await runRefundOnce(repo,provider);expect(provider.refundWithResult).not.toHaveBeenCalled();
 });
});
