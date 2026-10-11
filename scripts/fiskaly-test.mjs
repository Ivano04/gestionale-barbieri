import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { FiskalyTestClient, fiskalyTestConfigFromEnv } from '../src/services/fiscal/fiskaly-test-client.ts';

const help = `Prova isolata fiskaly SIGN IT (solo TEST, Node >= 22.18).
node --env-file=.env.local scripts/fiskaly-test.mjs auth
node --env-file=.env.local scripts/fiskaly-test.mjs system
node --env-file=.env.local scripts/fiskaly-test.mjs receipt <operation.json> <session.json>
node --env-file=.env.local scripts/fiskaly-test.mjs record <record-uuid>
La sessione conserva le chiavi e gli ID. Riutilizzare lo stesso file per riprendere.
PDF: node --env-file=.env.local scripts/fiskaly-test.mjs pdf <record-uuid>
Rettifica ancora da implementare.`;

function summary(result) {
  const c = result?.content;
  if (!c?.id) throw new Error('Risposta senza identificativo: verificare l’esito in HUB.');
  return { id: c.id, type: c.type, state: c.state, mode: c.mode };
}

async function main() {
  const [command, arg, sessionArg] = process.argv.slice(2);
  if (!command || command === 'help') { console.log(help); return; }
  if (!['auth', 'system', 'receipt', 'record', 'pdf'].includes(command)) throw new Error(help);
  if ((['record', 'pdf'].includes(command) && !arg) || (command === 'receipt' && (!arg || !sessionArg))) throw new Error(help);
  const config = fiskalyTestConfigFromEnv();
  const client = new FiskalyTestClient(config);
  if (command === 'auth') {
    await client.authenticate();
    console.log('Autenticazione TEST riuscita. Token e segreti non vengono stampati.');
  } else if (command === 'system') {
    console.log(summary(await client.getSystem()));
  } else if (command === 'pdf') {
    const pdf = await client.getRecordPdf(arg);
    const root = resolve('.superpowers/fiskaly-test');
    mkdirSync(root, { recursive: true });
    const output = resolve(root, arg + '.pdf');
    writeFileSync(output, pdf, { flag: 'wx', mode: 0o600 });
    console.log('PDF TEST salvato: ' + output);
    console.log('In sandbox il PDF e un esempio e non riproduce gli importi inviati.');  } else if (command === 'record') {
    console.log(summary(await client.getRecord(arg)));
  } else {
    const operation = JSON.parse(readFileSync(resolve(arg), 'utf8'));
    if (operation.type !== 'RECEIPT') throw new Error('Il file deve contenere una operazione RECEIPT.');
    const sessionPath = resolve(sessionArg);
    const sessionRoot = resolve('.superpowers/fiskaly-test');
    const { relative, isAbsolute } = await import('node:path');
    const rel = relative(sessionRoot, sessionPath);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Salvare la sessione sotto .superpowers/fiskaly-test/.');
    let session;
    try { session = JSON.parse(readFileSync(sessionPath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      session = { environment: 'test', systemId: config.systemId, operation,
        intentionKey: randomUUID(), transactionKey: randomUUID() };
      mkdirSync(dirname(sessionPath), { recursive: true });
      writeFileSync(sessionPath, JSON.stringify(session, null, 2), { flag: 'wx', mode: 0o600 });
    }
    if (session.environment !== 'test' || session.systemId !== config.systemId ||
        JSON.stringify(session.operation) !== JSON.stringify(operation)) {
      throw new Error('Sessione incompatibile: non cambiare sistema o payload durante una ripresa.');
    }
    // Eseguire una sola istanza per sessione. La scrittura avviene prima delle chiamate.
    const save = () => writeFileSync(sessionPath, JSON.stringify(session, null, 2), { mode: 0o600 });
    if (!session.intentionId) {
      session.intentionId = summary(await client.createIntention(session.intentionKey)).id;
      save();
    }
    if (!session.recordId) {
      session.recordId = summary(await client.submitReceipt(session.intentionId, operation, session.transactionKey)).id;
      save();
    }
    console.log(summary(await client.getRecord(session.recordId)));
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Prova fiskaly fallita.');
  process.exitCode = 1;
});
