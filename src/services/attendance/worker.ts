import { createAdminClient } from '@/lib/supabase/admin';
import { createEmailProvider, emailConfigFromEnv } from '@/services/notifications';
import type { EmailProvider } from '@/services/notifications/types';
import { noShowEmail, type NoShowEmailPayload } from './email';
export interface NoShowEmailJob { id:string;salon_id:string;client_id:string;visit_date:string;lease_token:string;recipient:string;payload:NoShowEmailPayload;attempts:number;first_attempt_at:string }
export interface NoShowEmailRepo {
  claim():Promise<NoShowEmailJob|null>;
  prepare(job:NoShowEmailJob):Promise<NoShowEmailJob|null>;
  current(job:NoShowEmailJob):Promise<boolean>;
  checkpoint(job:NoShowEmailJob,values:Record<string,unknown>):Promise<void>;
}
export async function runNoShowEmailOnce(repo:NoShowEmailRepo,provider:EmailProvider,testRecipient:string,now=Date.now()) {
  const claimed=await repo.claim();if(!claimed)return 'idle';
  const job=await repo.prepare(claimed);if(!job)return 'processed';
  if(!testRecipient||job.recipient.toLowerCase()!==testRecipient.toLowerCase()){
    await repo.checkpoint(job,{state:'blocked',last_error_code:'EMAIL_TEST_RECIPIENT_REQUIRED'});return 'processed';
  }
  if(!Number.isFinite(Date.parse(job.first_attempt_at))||now-Date.parse(job.first_attempt_at)>=23*3600000){
    await repo.checkpoint(job,{state:'uncertain',last_error_code:'EMAIL_RECONCILIATION_REQUIRED'});return 'processed';
  }
  if(!await repo.current(job))return 'processed';
  const message=noShowEmail(job.payload);let id:string;
  try {
    const sent=await provider.send({...message,to:job.recipient,idempotencyKey:'no-show/'+job.id});
    if(!sent.id)throw new Error('Missing provider ID');id=sent.id;
  }catch{
    await repo.checkpoint(job,{state:job.attempts>=5?'uncertain':'pending',last_error_code:'EMAIL_SEND_UNCERTAIN',available_at:new Date(now+Math.min(30*60000,60000*2**job.attempts)).toISOString()});return 'processed';
  }
  // A checkpoint failure is recovered using the same frozen payload and provider key.
  await repo.checkpoint(job,{state:'sent',provider_email_id:id,sent_at:new Date(now).toISOString(),last_error_code:null});return 'processed';
}
let running=false;
export async function runNoShowEmailBatch(){
  if(running||process.env.NO_SHOW_EMAIL_ENABLED==='false')return;
  const config=emailConfigFromEnv();if(!config.apiKey)return;
  // This deployment is TEST only. Never reroute a customer's message to another address.
  if((process.env.NO_SHOW_EMAIL_MODE??'test')!=='test')return;
  running=true;
  try{
    const db=createAdminClient();
    const repo:NoShowEmailRepo={
      async claim(){const {data,error}=await db.rpc('claim_no_show_email');if(error)throw new Error('No-show queue unavailable');return data?.[0]??null;},
      async prepare(job){const {data,error}=await db.rpc('prepare_no_show_email',{p_id:job.id,p_lease:job.lease_token});if(error)throw new Error('No-show preparation failed');return data?.[0]??null;},
      async current(job){const {data,error}=await db.from('no_show_emails').select('id').eq('id',job.id).eq('state','running').eq('lease_token',job.lease_token).gt('lease_until',new Date().toISOString()).maybeSingle();if(error)throw new Error('No-show delivery check failed');return !!data;},
      async checkpoint(job,values){const {data,error}=await db.from('no_show_emails').update({...values,lease_until:null,lease_token:null}).eq('id',job.id).eq('lease_token',job.lease_token).eq('state','running').select('id');if(error)throw new Error('No-show checkpoint failed');
        // Restoring attendance can cancel a message while a provider request is already in flight.
        if(!data?.length&&values.state==='sent'){const {error:acceptedError}=await db.from('no_show_emails').update({state:'sent',provider_email_id:values.provider_email_id,sent_at:values.sent_at,last_error_code:'RESTORED_DURING_SEND'}).eq('id',job.id).eq('state','cancelled').not('first_attempt_at','is',null);if(acceptedError)throw new Error('No-show acceptance checkpoint failed');}
      },
    };
    const underlying=createEmailProvider(config);
    const provider:EmailProvider={async send(message){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([underlying.send(message),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Email timeout')),20000);})]);}finally{if(timer)clearTimeout(timer);}}};
    const recipient=process.env.NO_SHOW_EMAIL_TEST_TO??process.env.FISKALY_TEST_EMAIL_TO??'';
    for(let i=0;i<10;i++)if(await runNoShowEmailOnce(repo,provider,recipient)==='idle')break;
  }finally{running=false;}
}
export function startNoShowEmailCron(){const tick=()=>{void runNoShowEmailBatch().catch(()=>console.error('[attendance] Email queue unavailable'));};setTimeout(tick,15000);setInterval(tick,60000);}
