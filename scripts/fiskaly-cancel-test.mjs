import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { FiskalyTestClient, fiskalyTestConfigFromEnv } from '../src/services/fiscal/fiskaly-test-client.ts';

async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (command !== 'cancel' || extra.length) throw new Error('Uso: node --env-file=.env.local scripts/fiskaly-cancel-test.mjs cancel');
  const config = fiskalyTestConfigFromEnv();
  const client = new FiskalyTestClient(config);
  const source = JSON.parse(readFileSync(resolve('.superpowers/fiskaly-test/prova-001.json'), 'utf8'));
  if (source.environment !== 'test' || source.systemId !== config.systemId ||
      source.operation?.type !== 'RECEIPT' || !source.recordId) throw new Error('Sessione ricevuta TEST incompatibile.');
  const path = resolve('.superpowers/fiskaly-test/prova-001-annullo.json');
  const lockPath = path + '.lock';
  const lock = openSync(lockPath, 'wx');
  try {
    let session;
    try { session = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      session = { environment: 'test', systemId: config.systemId, originalRecordId: source.recordId,
        intentionKey: randomUUID(), transactionKey: randomUUID() };
      writeFileSync(path, JSON.stringify(session, null, 2), { flag: 'wx', mode: 0o600 });
    }
    if (session.environment !== 'test' || session.systemId !== config.systemId ||
        session.originalRecordId !== source.recordId) throw new Error('Sessione annullo incompatibile.');
    const save = () => {
      writeFileSync(path + '.tmp', JSON.stringify(session, null, 2), { mode: 0o600 });
      renameSync(path + '.tmp', path);
    };
    const id = result => {
      const value = result.content?.id;
      if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error('Risposta senza UUID: conservare la sessione.');
      }
      return value;
    };
    if (!session.intentionId) {
      const original = await client.getRecord(source.recordId);
      if (original.content?.id !== source.recordId || original.content.type !== 'TRANSACTION::RECEIPT' ||
          original.content.state !== 'COMPLETED' || original.content.mode !== 'FINISHED') throw new Error('Ricevuta originale non completata.');
      session.intentionId = id(await client.createIntention(session.intentionKey)); save();
    }
    if (!session.recordId) {
      session.recordId = id(await client.submitCancellation(session.intentionId, source.recordId, session.transactionKey)); save();
    }
    const result = await client.getRecord(session.recordId);
    if (result.content?.id !== session.recordId) throw new Error('Identificativo annullo inatteso.');
    console.log('Documento di annullo TEST:', { id: result.content.id, type: result.content.type,
      state: result.content.state, mode: result.content.mode, originalRecordId: source.recordId });
    if (result.content.type !== 'TRANSACTION::CANCELLATION' ||
        result.content.state !== 'COMPLETED' || result.content.mode !== 'FINISHED') {
      throw new Error('Annullo non completato: conservare la sessione per verificare l esito.');
    }
    console.log('Annullo TEST completato. Ricevuta originale e sessione conservate.');
  } finally { closeSync(lock); unlinkSync(lockPath); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Annullo TEST fallito.'); process.exitCode = 1; });