# Prima prova fiskaly SIGN IT — solo TEST

## Ambito
Documento commerciale di prova, separato da fattura elettronica SdI.
Prima milestone: autenticazione, verifica sistema, intenzione, invio ricevuta e recupero stato.
Nessun collegamento a pagamenti, appuntamenti, email o database del salone.
La prova remota non è validata finché non è eseguita con credenziali TEST.
Download ufficiale, annullo/reso e pagamento elettronico richiedono verifica dello schema API e della sandbox prima di completare la fase 2.
Il fixture usa CASH, come l'esempio ufficiale; non rappresenta un pagamento Nexi né una regola IVA del salone.

## Configurazione locale
Creare .env.local (ignorato da Git), copiando le variabili:
```dotenv
FISKALY_ENV=test
FISKALY_API_KEY=
FISKALY_API_SECRET=
FISKALY_SYSTEM_ID=
```
Chiave e segreto devono appartenere a TEST. Non usare NEXT_PUBLIC_ e non inviare segreti in chat.
Il client ha un indirizzo TEST fisso e rifiuta override LIVE.
Utilizzare credenziali dell'organizzazione UNIT che contiene il sistema.
Prima della prova, configurare su HUB/API le risorse dell'esercente TEST e portare il sistema a COMMISSIONED seguendo la guida.
Le credenziali GROUP iniziali bastano per verificare auth ma non sostituiscono il setup UNIT.
Non inserire credenziali AdE reali per fare questa prova: seguire le istruzioni TEST del provider.

## Esecuzione
Richiede Node >= 22.18 (sviluppo locale attuale: Node 24). Eseguire dalla radice:
```powershell
node scripts/fiskaly-test.mjs help
node --env-file=.env.local scripts/fiskaly-test.mjs auth
node --env-file=.env.local scripts/fiskaly-test.mjs system
node --env-file=.env.local scripts/fiskaly-test.mjs receipt scripts/fixtures/fiskaly-receipt-test.json .superpowers/fiskaly-test/prova-001.json
node --env-file=.env.local scripts/fiskaly-test.mjs record UUID_DEL_RECORD
```
Una sola istanza per sessione. In caso di timeout, rieseguire lo stesso comando con lo stesso file sessione: le chiavi POST rimangono identiche.
Non cancellare il file sessione dopo un errore: creandone un altro si avvia un'altra emissione.
Per una nuova prova usare una nuova sessione e un numero documento diverso nel fixture.
Lo stato è riepilogato senza stampare token, credenziali o risposta integrale.
Una risposta HTTP positiva non basta a dimostrare completamento: verificare state e mode del record.
La persistenza su file serve soltanto al PoC; la futura integrazione userà transazioni e coda DB.

## Verifiche locali
```powershell
npx vitest run src/services/fiscal/fiskaly-test-client.test.ts
npx tsc --noEmit --incremental false
```
Test locali con HTTP simulato, senza chiamate esterne.

## Documentazione usata
- https://workspace.fiskaly.com/sign-it/2026-06-01/integration-guide
- https://workspace.fiskaly.com/sign-it/2026-06-01/record-states-and-modes/
Versione API fissata a 2026-06-01. Gli schemi di rettifica/artifact non vengono inventati.

## Setup TEST verificato
Autenticazione della Unit, creazione e attivazione del Taxpayer, verifica HEAD_OFFICE,
creazione e attivazione del System sono state eseguite con successo in sandbox.
Ricevuta CASH, recupero della sessione completata, PDF dimostrativo e annullo sono stati verificati in TEST.

Dalla radice del progetto:
~~~powershell
node --env-file=.env.local scripts/fiskaly-taxpayer-test.mjs create
node --env-file=.env.local scripts/fiskaly-taxpayer-test.mjs commission
node --env-file=.env.local scripts/fiskaly-system-test.mjs create
node --env-file=.env.local scripts/fiskaly-system-test.mjs commission
~~~
Gli script di setup sono dedicati alla Unit HairforceProva.
Riutilizzare la sessione .superpowers/fiskaly-test/hairforce-taxpayer.json:
contiene UUID e chiavi di idempotenza, viene esclusa da Git e non va cancellata.
Il comando commission del sistema stampa FISKALY_SYSTEM_ID da salvare in .env.local.
Il warning MODULE_TYPELESS_PACKAGE_JSON di Node non impedisce l'esecuzione.

## Pubblicazione
Questa prova viene eseguita localmente. Non richiede il deploy dell'app.
Il repository contiene un deploy manuale Hetzner in scripts/deploy.sh.
Le impostazioni esterne di GitHub o del server non sono determinate dai file del repository.
## Ricevuta, PDF e annullo verificati in TEST
La ricevuta e il documento di annullo hanno restituito COMPLETED / FINISHED.
La ripetizione dei comandi con le stesse sessioni recupera gli stessi ID:
questo verifica il recupero di sessioni completate, non simula timeout durante emissione.
Il PDF TEST e dimostrativo e non riproduce necessariamente gli importi inviati.

~~~powershell
node --env-file=.env.local scripts/fiskaly-test.mjs pdf UUID_RICEVUTA
node --env-file=.env.local scripts/fiskaly-cancel-test.mjs cancel
~~~
L'annullo usa la ricevuta registrata in prova-001.json e salva una sessione separata
prova-001-annullo.json. Non cancellare o modificare queste sessioni.
Rimangono da verificare pagamento elettronico, recupero di una scrittura interrotta e reso CORRECTION.
Il modulo non e ancora collegato a Nexi, database, Cassa o Resend.