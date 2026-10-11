import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { FiskalyTestClient, fiskalyTestConfigFromEnv } from '../src/services/fiscal/fiskaly-test-client.ts';

const organizationId = 'd8598896-5164-44c0-8ffa-482e72e69b8a';
const sessionPath = resolve('.superpowers/fiskaly-test/hairforce-taxpayer.json');
async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (!['create', 'commission'].includes(command) || extra.length) throw new Error('Uso: node --env-file=.env.local scripts/fiskaly-system-test.mjs create|commission');
  const client = new FiskalyTestClient(fiskalyTestConfigFromEnv());
  await client.assertOrganization(organizationId);
  const lockPath = sessionPath + '.lock';
  const lock = openSync(lockPath, 'wx');
  try {
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
    if (session.environment !== 'test' || session.organizationId !== organizationId || !session.taxpayerId) {
      throw new Error('Sessione Taxpayer TEST mancante o incompatibile.');
    }
    const taxpayer = await client.getTaxpayer(organizationId, session.taxpayerId);
    if (taxpayer.content?.id !== session.taxpayerId || taxpayer.content.state !== 'COMMISSIONED' ||
        taxpayer.content.mode !== 'OPERATIVE') throw new Error('Taxpayer non attivo.');
    const location = await client.getLocation(organizationId, session.taxpayerId);
    if (location.content?.id !== session.taxpayerId || location.content.type !== 'HEAD_OFFICE' ||
        location.content.state !== 'COMMISSIONED' || location.content.mode !== 'OPERATIVE') {
      throw new Error('Sede automatica HEAD_OFFICE non confermata.');
    }
    console.log('Sede TEST verificata:', { id: location.content.id, state: location.content.state, mode: location.content.mode });
    const save = () => {
      writeFileSync(sessionPath + '.tmp', JSON.stringify(session, null, 2), { mode: 0o600 });
      renameSync(sessionPath + '.tmp', sessionPath);
    };
    if (command === 'commission' && !session.systemId) throw new Error('System mancante nella sessione: completare create.');
    if (!session.systemCreationKey) { session.systemCreationKey = randomUUID(); save(); }
    if (!session.systemId) {
      const created = await client.createTestSystem(organizationId, session.taxpayerId, session.systemCreationKey);
      if (typeof created.content?.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(created.content.id)) {
        throw new Error('Risposta senza UUID sistema: conservare la sessione e riprendere lo stesso comando.');
      }
      session.systemId = created.content.id; save();
    }
    if (command === 'commission' && !session.systemCommissionKey) {
      session.systemCommissionKey = randomUUID(); save();
    }
    const system = command === 'commission'
      ? await client.commissionSystem(organizationId, session.systemId, session.systemCommissionKey)
      : await client.getTestSystem(organizationId, session.systemId);
    if (system.content?.id !== session.systemId) throw new Error('Identificativo sistema inatteso.');
    console.log(command === 'commission' ? 'System TEST attivato e verificato:' : 'System TEST creato e recuperato:', { id: system.content.id, state: system.content.state, mode: system.content.mode });
    if (command === 'commission') console.log('Inserire in .env.local: FISKALY_SYSTEM_ID=' + system.content.id);
    else console.log('Conservare la sessione. Il prossimo passaggio e attivare il System; lasciare FISKALY_SYSTEM_ID vuoto.');
  } finally { closeSync(lock); unlinkSync(lockPath); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Configurazione sistema fallita.'); process.exitCode = 1; });