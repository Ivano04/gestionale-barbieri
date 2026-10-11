import { describe, it, expect, vi } from 'vitest';
import { runFiscalWorkerOnce, FiscalLeaseLost, type FiscalWork, type FiscalWorkerRepo } from './worker';
import { FiskalyTestError } from './fiskaly-test-client';
const id = '10000000-0000-4000-8000-000000000001';
function setup() {
 const work: FiscalWork = {jobId:id,documentId:id,salonId:id,leaseToken:id,attempts:1,mode:'test',operation:'receipt',
 snapshot:{type:'RECEIPT'},configuration:{provider:'fiskaly',mode:'test',organization_id:id,system_id:id},
 intentionKey:id,transactionKey:id};
 const repo: FiscalWorkerRepo = {claim:vi.fn(async()=>work),checkpoint:vi.fn(async()=>{})};
 const provider = {assertOrganization:vi.fn(async()=>{}),createIntention:vi.fn(async()=>({content:{id}})),
 submitReceipt:vi.fn(async()=>({content:{id}})),getRecord:vi.fn(async()=>({content:{id,type:'TRANSACTION::RECEIPT',state:'COMPLETED',mode:'FINISHED'}}))};
 return {work,repo,provider};
}
describe('fiscal worker',()=>{
 it('salva progressi prima di completare',async()=>{
  const {repo,provider}=setup();
  expect(await runFiscalWorkerOnce(repo,()=>provider)).toBe('processed');
  expect(repo.checkpoint).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({outcome:'completed',recordId:id}));
  expect(provider.submitReceipt).toHaveBeenCalledWith(id,{type:'RECEIPT'},id);
 });
 it('riprende un record esistente senza nuove scritture provider',async()=>{
  const {work,repo,provider}=setup();work.intentionId=id;work.recordId=id;
  await runFiscalWorkerOnce(repo,()=>provider);
  expect(provider.createIntention).not.toHaveBeenCalled();expect(provider.submitReceipt).not.toHaveBeenCalled();
 });
 it('conserva chiave e programma ripresa su esito incerto',async()=>{
  const {repo,provider}=setup();
  provider.submitReceipt.mockRejectedValueOnce(new FiskalyTestError('timeout',null,true));
  await runFiscalWorkerOnce(repo,()=>provider);
  expect(repo.checkpoint).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({outcome:'uncertain',intentionId:id}));
 });
 it('si ferma se perde la lease prima dell emissione',async()=>{
  const {repo,provider}=setup();
  vi.mocked(repo.checkpoint).mockRejectedValueOnce(new FiscalLeaseLost());
  expect(await runFiscalWorkerOnce(repo,()=>provider)).toBe('lease_lost');
  expect(provider.createIntention).not.toHaveBeenCalled();
 });
 it('emette annullo collegato alla ricevuta senza ripetere la vendita',async()=>{
  const {work,repo,provider}=setup();work.operation='cancellation';work.snapshot={type:'CANCELLATION',record:{id}};work.originalRecordId=id;
  const cancellationProvider={...provider,submitCancellation:vi.fn(async()=>({content:{id}}))};
  provider.getRecord.mockResolvedValue({content:{id,type:'TRANSACTION::CANCELLATION',state:'COMPLETED',mode:'FINISHED'}});
  await runFiscalWorkerOnce(repo,()=>cancellationProvider);
  expect(cancellationProvider.submitCancellation).toHaveBeenCalledWith(id,id,id);expect(provider.submitReceipt).not.toHaveBeenCalled();
 });
 it('rifiuta LIVE senza contattare fiskaly',async()=>{
  const {work,repo,provider}=setup();work.mode='live';
  await runFiscalWorkerOnce(repo,()=>provider);
  expect(provider.assertOrganization).not.toHaveBeenCalled();
  expect(repo.checkpoint).toHaveBeenLastCalledWith(work,{outcome:'failed',errorCode:'INVALID_TEST_CONFIGURATION'});
 });
});
