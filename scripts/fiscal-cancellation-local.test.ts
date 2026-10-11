import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NexiProvider } from '../src/services/payments/nexi';
import { runRefundOnce } from '../src/services/payments/refund-worker';
import { refundWorkerRepo } from '../src/services/payments/refund-worker-repo';
import { createFiscalWorkerRepo } from '../src/services/fiscal/worker-repo';
import { runFiscalWorkerOnce } from '../src/services/fiscal/worker';
import { FiskalyTestClient, fiskalyTestConfigFromEnv } from '../src/services/fiscal/fiskaly-test-client';
import { makeCancelToken } from '../src/services/cancellation/token';
import { archiveFiscalTestPdfs } from '../src/services/fiscal/pdf-storage';
it.skipIf(process.env.FISCAL_LOCAL_CANCELLATION_TEST !== 'true')('cancels simulated booking, verifies mocked Nexi refund and emits real fiskaly TEST cancellation', async()=>{
 expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');expect(process.env.FISKALY_ENV).toBe('test');expect(process.env.NEXI_ENV).toBe('test');
 expect(process.env.FISKALY_TEST_REFUNDS_ENABLED).not.toBe('true');
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
 const paymentId='29effce3-2bf0-4512-8db4-5a51d898eba3';
 const {data:appt,error:apptError}=await db.from('appointments').select('notes,status').eq('id',paymentId).single();
 expect(apptError).toBeNull();expect(appt?.notes).toContain('Notifica Nexi SIMULATA');
 const {data:original,error:originalError}=await db.from('fiscal_documents').select('id,provider_record_id').eq('payment_id',paymentId).eq('operation','receipt').single();
 expect(originalError).toBeNull();expect(original?.provider_record_id).toBeTruthy();
 const {data:first,error:firstError}=await db.rpc('cancel_appointment_fiscal_test',{p_appointment_id:paymentId,p_initiator:'staff',p_window_hours:24});
 expect(firstError).toBeNull();expect(first.ok).toBe(true);
 const {data:second,error:secondError}=await db.rpc('cancel_appointment_fiscal_test',{p_appointment_id:paymentId,p_initiator:'staff',p_window_hours:24});
 expect(secondError).toBeNull();expect(second.alreadyCancelled).toBe(true);
 let calls=0;
 const provider=new NexiProvider({alias:'SIMULATED-TEST',macKey:'SIMULATED-SECRET',env:'test',fetchImpl:async()=>{
  calls++;const response={esito:'OK',idOperazione:'SIMULATED-refund-'+paymentId,timeStamp:'1700000000000'};
  const mac=createHash('sha1').update(`esito=${response.esito}idOperazione=${response.idOperazione}timeStamp=${response.timeStamp}SIMULATED-SECRET`).digest('hex');
  return new Response(JSON.stringify({...response,mac}),{status:200,headers:{'Content-Type':'application/json'}});
 }});
 const {data:priorRefund}=await db.from('refund_jobs').select('state').eq('payment_id',paymentId).single();
 if(priorRefund?.state!=='accepted') {
  await runRefundOnce(refundWorkerRepo(db),provider);expect(calls).toBe(1);
 }
 const {data:pay}=await db.from('payments').select('status').eq('id',paymentId).single();expect(pay?.status).toBe('refunded');
 const {error:enqueueError}=await db.rpc('enqueue_refunded_fiscal_cancellations');expect(enqueueError).toBeNull();
 const {data:repeat,error:repeatError}=await db.rpc('enqueue_refunded_fiscal_cancellations');expect(repeatError).toBeNull();expect(repeat).toBe(0);
 const config=fiskalyTestConfigFromEnv();
 const repo=createFiscalWorkerRepo(db);
 for(let i=0;i<5;i++){
  if(await runFiscalWorkerOnce(repo,work=>new FiskalyTestClient({...config,systemId:work.configuration.system_id}))==='idle')break;
 }
 await archiveFiscalTestPdfs(db);
 const {data:cancellations,error:readError}=await db.from('fiscal_documents').select('id,provider_record_id,processing_status,pdf_storage_path').eq('original_document_id',original!.id).eq('operation','cancellation');
 expect(readError).toBeNull();expect(cancellations).toHaveLength(1);expect(cancellations![0].processing_status).toBe('completed');expect(cancellations![0].pdf_storage_path).toBeTruthy();
 const {data:markedOriginal}=await db.from('fiscal_documents').select('status').eq('id',original!.id).single();expect(markedOriginal?.status).toBe('canceled');
 const token=makeCancelToken(paymentId,process.env.CRON_SECRET!);
 const response=await fetch('http://localhost:3000/api/appointments/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
 expect(response.status).toBe(200);const result=await response.json();expect(result.alreadyCancelled).toBe(true);expect(result.refunded).toBe(true);
 console.log('Rimborso Nexi SIMULATO; annullo fiskaly TEST completato; original receipt and PDFs retained.');
},120000);
