import { writeFileSync } from 'node:fs';
const [file,salonId,organizationId,taxpayerId,locationId] = process.argv.slice(2);
const e=process.env;
if (e.FISKALY_ENV!=='test'||e.NEXI_ENV!=='test'||e.PAYMENT_PROVIDER!=='nexi') throw new Error('Only TEST deployment supported');
for(const id of [salonId,organizationId,taxpayerId,locationId,e.FISKALY_SYSTEM_ID]) if(!/^[0-9a-f-]{36}$/i.test(id||'')) throw new Error('Missing TEST resource identifier');
for(const key of ['FISKALY_API_KEY','FISKALY_API_SECRET','RESEND_API_KEY','FISKALY_TEST_EMAIL_TO']) if(!e[key]) throw new Error('Missing '+key);
const env={NO_SHOW_EMAIL_ENABLED:'true',NO_SHOW_EMAIL_MODE:'test',NO_SHOW_EMAIL_TEST_TO:e.FISKALY_TEST_EMAIL_TO,FISKALY_ENV:'test',FISKALY_API_KEY:e.FISKALY_API_KEY,FISKALY_API_SECRET:e.FISKALY_API_SECRET,FISKALY_SYSTEM_ID:e.FISKALY_SYSTEM_ID,
 FISKALY_TEST_ENABLED:'true',FISKALY_TEST_REFUNDS_ENABLED:'false',FISKALY_TEST_VAT_PERCENT:e.FISKALY_TEST_VAT_PERCENT||'22',
 FISKALY_TEST_EMAIL_ENABLED:'true',FISKALY_TEST_EMAIL_TO:e.FISKALY_TEST_EMAIL_TO,RESEND_API_KEY:e.RESEND_API_KEY,RESEND_FROM:e.RESEND_FROM||'onboarding@resend.dev'};
writeFileSync(file,JSON.stringify({salonId,organizationId,taxpayerId,locationId,env}),{mode:0o600});
console.log('Private fiscal TEST configuration prepared; no secrets printed.');
