import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const base = 'http://localhost:3000';
const salon = '11111111-1111-1111-1111-111111111111';
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321');
assert.equal(process.env.NEXI_ENV, 'test');
assert.equal(process.env.FISKALY_ENV, 'test');
assert.equal(process.env.FISKALY_TEST_ENABLED, 'true');
assert.ok(process.env.NEXI_MAC_KEY);
assert.ok(!process.env.NEXT_PUBLIC_APP_URL || new URL(process.env.NEXT_PUBLIC_APP_URL).origin === base);
assert.ok(!process.env.TREATWELL_API_TOKEN && !process.env.GHL_AGENCY_API_KEY && !process.env.N8N_WEBHOOK_URL);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function rows(query) {
  const { data, error } = await query;
  if (error) throw new Error('Local database verification failed: ' + error.code);
  return data;
}
const [service] = await rows(db.from('services').select('id,duration_minutes,price_cents').eq('salon_id', salon).eq('is_active', true).gt('price_cents', 0).limit(1));
const [stylist] = await rows(db.from('users').select('id').eq('salon_id', salon).limit(1));
assert.ok(service && stylist);
const salonRow = await rows(db.from('salons').select('ghl_subaccount_id,treatwell_api_enabled,working_hours,open_time,close_time').eq('id', salon).single());
assert.ok(!salonRow.ghl_subaccount_id && !salonRow.treatwell_api_enabled);
assert.ok(!salonRow.working_hours || Object.keys(salonRow.working_hours).length === 0);
let start;
for (let offset = 7; offset < 30; offset++) {
  const candidate = new Date(); candidate.setUTCDate(candidate.getUTCDate() + offset); candidate.setUTCHours(11, 0, 0, 0);
  const end = new Date(candidate.getTime() + service.duration_minutes * 60000).toISOString();
  const conflicts = await rows(db.from('appointments').select('id').eq('salon_id', salon).eq('stylist_id', stylist.id).neq('status', 'cancelled').lt('start_time', end).gt('end_time', candidate.toISOString()));
  const blocks = await rows(db.from('time_blocks').select('id').eq('salon_id', salon).lt('start_time', end).gt('end_time', candidate.toISOString()));
  if (!conflicts.length && !blocks.length) { start = candidate.toISOString(); break; }
}
assert.ok(start, 'No free local TEST slot');
const run = randomUUID();
const booking = { salon_id: salon, service_id: service.id, stylist_id: stylist.id, start_time: start, source: 'widget', client: { first_name: 'TEST', last_name: 'Flusso fiscale', phone: 'TEST-' + run }, notes: 'Notifica Nexi SIMULATA, nessun incasso reale. Run ' + run };
const checkoutResponse = await fetch(base + '/api/payments/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking }), signal: AbortSignal.timeout(60000) });
assert.equal(checkoutResponse.status, 200, 'Checkout failed');
const checkout = await checkoutResponse.json();
assert.ok(checkout.paymentId && checkout.providerRef);
console.log('Checkout locale TEST creato:', checkout.paymentId);
const params = { codTrans: checkout.providerRef, esito: 'OK', importo: String(service.price_cents), divisa: 'EUR', data: '20261011', orario: '120000', codAut: 'TEST00' };
const signed = `codTrans=${params.codTrans}esito=${params.esito}importo=${params.importo}divisa=${params.divisa}data=${params.data}orario=${params.orario}codAut=${params.codAut}${process.env.NEXI_MAC_KEY}`;
const mac = createHash('sha1').update(signed).digest('hex');
async function notify(signature) {
  return fetch(base + '/api/webhooks/payments/nexi', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, mac: signature }), signal: AbortSignal.timeout(60000) });
}
assert.equal((await notify('invalid')).status, 400, 'Invalid MAC accepted');
assert.equal((await rows(db.from('payments').select('status').eq('id', checkout.paymentId).single())).status, 'pending');
for (let i = 0; i < 2; i++) {
  const response = await notify(mac);
  if (response.status !== 200) throw new Error('Signed simulated notification failed: HTTP ' + response.status + ' ' + (await response.text()).slice(0, 200));
}
const payment = await rows(db.from('payments').select('status,appointment_id').eq('id', checkout.paymentId).single());
assert.equal(payment.status, 'succeeded'); assert.equal(payment.appointment_id, checkout.paymentId);
assert.equal((await rows(db.from('appointments').select('id').eq('id', checkout.paymentId))).length, 1);
const documents = await rows(db.from('fiscal_documents').select('id,appointment_id,processing_status,provider_record_id').eq('payment_id', checkout.paymentId));
assert.equal(documents.length, 1); assert.equal(documents[0].appointment_id, payment.appointment_id);
assert.equal((await rows(db.from('fiscal_jobs').select('id').eq('document_id', documents[0].id))).length, 1);
assert.equal((await rows(db.from('payment_events').select('id').eq('payment_id', checkout.paymentId))).length, 1);
console.log('MAC errato rifiutato; doppia notifica: un pagamento, un appuntamento, un documento, un job, un evento.');
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  const document = await rows(db.from('fiscal_documents').select('processing_status,provider_record_id,last_error_code').eq('id', documents[0].id).single());
  if (document.processing_status === 'completed') { assert.ok(document.provider_record_id); console.log('Documento fiskaly TEST completato:', document.provider_record_id); process.exit(0); }
  if (document.processing_status === 'failed') throw new Error('Fiscal worker failed: ' + document.last_error_code);
  await new Promise(resolve => setTimeout(resolve, 5000));
}
throw new Error('Receipt not completed within 120 seconds; persistent TEST data retained for inspection.');
