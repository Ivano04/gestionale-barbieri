import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { FiskalyTestClient, fiskalyTestConfigFromEnv } from '../src/services/fiscal/fiskaly-test-client.ts';

const organizationId = 'd8598896-5164-44c0-8ffa-482e72e69b8a';
// Dati fiscali di esempio della guida fiskaly 2026-06-01; nessun dato reale del salone.
const content = {
  type: 'COMPANY',
  name: { legal: 'HairforceProva TEST', trade: 'HairforceProva TEST' },
  address: { line: { type: 'STREET_NUMBER', street: 'Via Roma', number: '123' },
    code: '00100', city: 'Rome', country: 'IT' },
  fiscalization: { type: 'IT', tax_id_number: '12345678901', vat_id_number: '12345678901',
    credentials: { type: 'FISCONLINE', pin: '1234567890', password: 'MySecurePassword123',
      tax_id_number: 'RSSMRA85M01H501Z' } },
};
const sessionPath = resolve('.superpowers/fiskaly-test/hairforce-taxpayer.json');
const help = 'node --env-file=.env.local scripts/fiskaly-taxpayer-test.mjs create|commission\n' +
  'Crea soltanto il Taxpayer TEST; conserva la sessione per riprendere senza duplicati.';

async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (!command || command === 'help') { console.log(help); return; }
  if (!['create', 'commission'].includes(command) || extra.length) throw new Error(help);
  const client = new FiskalyTestClient(fiskalyTestConfigFromEnv());
  await client.assertOrganization(organizationId);
  mkdirSync(dirname(sessionPath), { recursive: true });
  const lockPath = sessionPath + '.lock';
  let lock;
  try { lock = openSync(lockPath, 'wx'); }
  catch { throw new Error('Sessione occupata: una sola esecuzione alla volta. Se il processo e terminato, rimuovere soltanto il file .lock.'); }
  try {
    let session;
    try { session = JSON.parse(readFileSync(sessionPath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (command === 'commission') throw new Error('Sessione mancante: recuperare il file della creazione prima di attivare.');
      session = { environment: 'test', organizationId, content, creationKey: randomUUID() };
      writeFileSync(sessionPath, JSON.stringify(session, null, 2), { flag: 'wx', mode: 0o600 });
    }
    if (session.environment !== 'test' || session.organizationId !== organizationId ||
        JSON.stringify(session.content) !== JSON.stringify(content)) {
      throw new Error('Sessione incompatibile: non modificare dati o organizzazione durante una ripresa.');
    }
    if (command === 'commission' && !session.taxpayerId) throw new Error('Sessione senza Taxpayer: completare prima create.');
    if (!session.taxpayerId) {
      const result = await client.createTestTaxpayer(organizationId, content, session.creationKey);
      const id = result.content?.id;
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('Risposta senza UUID: riprendere con la stessa sessione.');
      }
      session.taxpayerId = id;
      const temporary = sessionPath + '.tmp';
      writeFileSync(temporary, JSON.stringify(session, null, 2), { mode: 0o600 });
      renameSync(temporary, sessionPath);
    }
    if (command === 'commission' && !session.commissionKey) {
      session.commissionKey = randomUUID();
      const temporary = sessionPath + '.tmp';
      writeFileSync(temporary, JSON.stringify(session, null, 2), { mode: 0o600 });
      renameSync(temporary, sessionPath);
    }
    const result = command === 'commission'
      ? await client.commissionTaxpayer(organizationId, session.taxpayerId, session.commissionKey)
      : await client.getTaxpayer(organizationId, session.taxpayerId);
    if (result.content?.id !== session.taxpayerId) throw new Error('Identificativo inatteso nella verifica.');
    console.log(command === 'commission' ? 'Taxpayer TEST attivato e verificato:' : 'Taxpayer TEST creato e recuperato:', {
      id: result.content.id, state: result.content.state, mode: result.content.mode,
    });
    console.log('Sessione salvata. Lasciare FISKALY_SYSTEM_ID vuoto; la configurazione del sistema e il prossimo passaggio.');
  } finally { closeSync(lock); unlinkSync(lockPath); }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Configurazione TEST fallita.');
  process.exitCode = 1;
});
