
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const container = 'supabase_db_gestionale-parrucchiere-Hairforce';
const database = 'fiscal_verify_' + randomUUID().replaceAll('-', '');
const run = (sql, db = database) => execFileSync('docker', ['exec', '-i', '-e', 'PGOPTIONS=-c jit=off', container, 'psql',
  '-X', '-qAt', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
const concurrent = sql => new Promise((resolve, reject) => execFile('docker', ['exec', '-e', 'PGOPTIONS=-c jit=off', container, 'psql',
  '-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-c',sql], (error, stdout) =>
  error ? reject(error) : resolve(stdout.trim())));
const id = () => randomUUID();
const receipt = JSON.parse(readFileSync('scripts/fixtures/fiskaly-receipt-card-test.json','utf8'));
const payload = "'" + JSON.stringify(receipt).replaceAll("'", "''") + "'::jsonb";
let count = 0;
const check = (name, test) => { test(); count++; console.log('OK ' + name); };
let created = false;
try {
  run('CREATE DATABASE ' + database, 'postgres'); created = true;
  run(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE TABLE public.salons(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text);
    CREATE TABLE public.appointments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),salon_id uuid REFERENCES salons(id));
    CREATE TABLE public.clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.users(id uuid, salon_id uuid, role text);
    CREATE FUNCTION public.get_user_salon_id() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN NEW.updated_at := now(); RETURN NEW; END;';
  `);
  run(readFileSync('supabase/migrations/012_payments_fiscal.sql','utf8'));
  run(readFileSync('supabase/migrations/014_fiscal_jobs.sql','utf8'));
  const salon = id(), payment = id();
  run(`INSERT INTO salons VALUES('${salon}','TEST');
    INSERT INTO payments(id,salon_id,provider,amount_cents,metadata) VALUES('${payment}','${salon}','nexi',2440,jsonb_build_object('payment_environment','test'));
    INSERT INTO fiscal_configs(salon_id,enabled,system_id,organization_id,taxpayer_id,location_id) VALUES('${salon}',true,'${id()}','${id()}','${id()}','${id()}');`);
  const register = (p=payment,event='evt',amount='2440',operation=payload) =>
    `SELECT register_paid_fiscal_test('${p}','${event}',${amount},${operation});`;
  const document = run(register());
  check('evento duplicato: stesso documento', () => assert.equal(run(register()), document));
  check('un solo lavoro persistente', () => assert.equal(run('SELECT count(*) FROM fiscal_jobs'), '1'));
  const reject = (name, sql) => check(name, () => assert.throws(() => run(sql)));
  reject('importo errato', register(payment,'bad','2400'));
  reject('importo NULL', register(payment,'null','NULL'));
  reject('snapshot incoerente', register(payment,'snapshot','2440',"'{}'::jsonb"));
  reject('pagamento sconosciuto', register(id(),'unknown'));
  run(`UPDATE payments SET status='refunded' WHERE id='${payment}'`);
  reject('pagamento rimborsato', register());
  run(`UPDATE payments SET status='succeeded' WHERE id='${payment}'`);
  run("UPDATE fiscal_configs SET mode='live'");
  reject('configurazione LIVE', register());
  run("UPDATE fiscal_configs SET mode='test',enabled=false");
  reject('configurazione disabilitata', register());
  run('UPDATE fiscal_configs SET enabled=true');
  check('errori senza scritture parziali', () => assert.equal(run('SELECT count(*) FROM payment_events'), '1'));
  check('browser non puo registrare incassi', () => assert.equal(run("SELECT has_function_privilege('authenticated','public.register_paid_fiscal_test(uuid,text,integer,jsonb)','EXECUTE')"), 'f'));
  reject('browser non puo leggere coda', 'SET ROLE authenticated; SELECT * FROM fiscal_jobs;');
  reject('durata lease invalida', 'SELECT * FROM claim_fiscal_job(1)');
  const firstLease = run('SELECT lease_token FROM claim_fiscal_job()');
  check('lavoro in corso non riacquisito', () => assert.equal(run('SELECT count(*) FROM claim_fiscal_job()'), '0'));
  run("UPDATE fiscal_jobs SET lease_until=now()-interval '1 second'");
  const renewed = run('SELECT lease_token FROM claim_fiscal_job()');
  check('lease scaduta recuperata con nuovo token', () => assert.notEqual(renewed, firstLease));
  check('worker precedente non puo aggiornare con vecchio token', () =>
    assert.equal(run(`WITH updated AS (UPDATE fiscal_jobs SET state='done' WHERE lease_token='${firstLease}' RETURNING id) SELECT count(*) FROM updated`), '0'));
  run("UPDATE fiscal_jobs SET state='done'");
  const p2=id();
  run(`INSERT INTO payments(id,salon_id,provider,amount_cents,metadata) VALUES('${p2}','${salon}','nexi',2440,jsonb_build_object('payment_environment','test'))`);
  const registrations = await Promise.all([
    concurrent('BEGIN; ' + register(p2,'parallel') + ' SELECT pg_sleep(1); COMMIT;'),
    concurrent('BEGIN; ' + register(p2,'parallel') + ' COMMIT;')
  ]);
  check('due notifiche simultanee: un documento', () => assert.equal(registrations[0].trim(),registrations[1].trim()));
  check('una sola coda per pagamento concorrente', () => assert.equal(run(`SELECT count(*) FROM fiscal_jobs j JOIN fiscal_documents d ON d.id=j.document_id WHERE d.payment_id='${p2}'`),'1'));
  const claims = await Promise.all([
    concurrent('BEGIN; SELECT id FROM claim_fiscal_job(); SELECT pg_sleep(1); COMMIT;'),
    concurrent('BEGIN; SELECT id FROM claim_fiscal_job(); COMMIT;')
  ]);
  check('due worker simultanei: una sola acquisizione', () => assert.equal(claims.filter(x=>x.trim()).length,1));
  const snapshot = run("SELECT configuration_snapshot FROM fiscal_documents WHERE id='" + document + "'");
  run("UPDATE fiscal_configs SET system_id='" + id() + "'");
  check('configurazione congelata nel documento', () => assert.equal(run("SELECT configuration_snapshot FROM fiscal_documents WHERE id='" + document + "'"),snapshot));
  reject('snapshot documento immutabile', "UPDATE fiscal_documents SET operation_snapshot='{}' WHERE id='" + document + "'");
  const otherSalon=id(), otherPayment=id(), otherAppointment=id();
  run("INSERT INTO salons VALUES('"+otherSalon+"','OTHER'); INSERT INTO payments(id,salon_id,provider,amount_cents,metadata) VALUES('"+otherPayment+"','"+otherSalon+"','nexi',2440,jsonb_build_object('payment_environment','test')); INSERT INTO appointments VALUES('"+otherAppointment+"','"+otherSalon+"')");
  reject('pagamento di altro salone', "UPDATE fiscal_documents SET payment_id='"+otherPayment+"' WHERE id='"+document+"'");
  reject('appuntamento di altro salone', "UPDATE fiscal_documents SET appointment_id='"+otherAppointment+"' WHERE id='"+document+"'");
  reject('coda di altro salone', "UPDATE fiscal_jobs SET salon_id='"+otherSalon+"'");
  const altered=JSON.parse(JSON.stringify(receipt)); altered.document.number='ALTERED';
  reject('duplicato con payload diverso', register(payment,'changed','2440',"'"+JSON.stringify(altered).replaceAll("'","''")+"'::jsonb"));
  const currentJob=run("SELECT id||','||lease_token FROM fiscal_jobs WHERE state='running'").split(',');
  check('checkpoint rifiuta token estraneo',()=>assert.equal(run("SELECT checkpoint_fiscal_job('"+currentJob[0]+"','"+id()+"','processing')"),'f'));
  const providerRecord=id(), providerIntention=id();
  check('checkpoint completa con lease valida',()=>assert.equal(run("SELECT checkpoint_fiscal_job('"+currentJob[0]+"','"+currentJob[1]+"','completed','"+providerIntention+"','"+providerRecord+"','COMPLETED','FINISHED')"),'t'));
  check('documento e lavoro completati insieme',()=>assert.equal(run("SELECT count(*) FROM fiscal_jobs j JOIN fiscal_documents d ON d.id=j.document_id WHERE j.id='"+currentJob[0]+"' AND j.state='done' AND d.processing_status='completed' AND d.status='confirmed'"),'1'));
  check('worker concluso non aggiorna piu',()=>assert.equal(run("SELECT checkpoint_fiscal_job('"+currentJob[0]+"','"+currentJob[1]+"','failed')"),'f'));
  console.log(count + ' verifiche PostgreSQL superate.');
} finally {
  if (created) run('DROP DATABASE ' + database + ' WITH (FORCE)', 'postgres');
}
