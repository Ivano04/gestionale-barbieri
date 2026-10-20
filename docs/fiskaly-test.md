# Prima prova fiskaly SIGN IT — solo TEST

## Ambito
Documento commerciale di prova, separato da fattura elettronica SdI.
Il client isolato e il collegamento fiscale del gestionale operano esclusivamente in TEST.
Sono verificati setup, ricevute CASH/CARD, PDF dimostrativo, annullo isolato,
persistenza dei pagamenti e delle operazioni fiscali, recupero della coda e pagina Cassa.
La notifica Nexi del flusso locale ? simulata e firmata: non ? un pagamento effettuato
sulla pagina sandbox Nexi. Il modulo email Resend TEST e implementato; la consegna reale richiede configurazione e verifica.
I rimborsi del flusso integrato restano da completare.

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
Il pagamento CARD ? stato verificato in sandbox. Il recupero di una risposta persa ? verificato
con provider simulato; il reso CORRECTION e il rimborso integrato restano da implementare.

## Flusso integrato locale e Cassa
Applicare le migrazioni 012?015 secondo lo stato del database. Nella prova locale sono
state applicate 012, 013, 014 e 015, senza modificare il database del server.
La configurazione fiscal_configs deve contenere gli identificativi UNIT, taxpayer,
location e system TEST ed essere abilitata. Le credenziali restano nelle variabili server.

~~~dotenv
FISKALY_TEST_ENABLED=true
FISKALY_TEST_VAT_PERCENT=22
CRON_SECRET=valore_casuale_server
~~~
L'aliquota 22 ? una scelta esplicita della prova, da configurare correttamente prima del LIVE.
Il checkout salva prezzo e dati fiscali immutabili. Il webhook verificato registra
pagamento, evento, documento e job in una transazione; la conferma collega l'appuntamento.
Il worker riprende le emissioni con le stesse chiavi di idempotenza. Numero documento
TEST di massimo 20 caratteri, con i caratteri ammessi dallo schema provider.

Il recupero PDF usa una coda separata basata sui documenti completati, con tentativi e
ritardo persistenti: un errore Storage non provoca un'altra emissione. Bucket privato
fiscal-documents, percorso salone/ambiente/documento.pdf, accessibile soltanto dal server.
/api/cassa legge tramite RLS dell'utente; il download verifica anche l'appartenenza al
salone e il percorso previsto prima di accedere a Storage. Nessun URL pubblico o
percorso Storage ? esposto nella lista. La pagina /cassa mostra pagamento, stato fiscale,
ambiente e disponibilit? del PDF, con paginazione e aggiornamento manuale.

Riavviare npm run dev dopo la modifica del cron: emissione e recupero PDF vengono
controllati ogni 30 secondi. Questa modalit? richiede un processo server persistente.
Il PDF TEST fornito da fiskaly ? dimostrativo e pu? mostrare importi diversi.

~~~powershell
npm test
npx tsc --noEmit --incremental false
node --env-file=.env.local scripts/fiscal-local-flow-test.mjs
$env:FISCAL_LOCAL_INTEGRATION='true'
node --env-file=.env.local node_modules/vitest/vitest.mjs run scripts/fiscal-cassa-local.test.ts
Remove-Item Env:FISCAL_LOCAL_INTEGRATION
~~~
La prova del flusso crea appuntamenti e documenti fittizi nel salone locale e li conserva.
La prova Cassa verifica la ricevuta di quel flusso (payment ID presente nello script),
crea due utenti temporanei e un secondo salone, e li rimuove al termine. Ha verificato:
download PDF autorizzato, lista del proprio salone, negazione al secondo salone,
negazione del download anonimo e della lettura diretta anonima su Storage.
Per un database locale differente adattare gli ID degli script, senza usarli in LIVE.
Rimane aperto il crash PostgreSQL della prova isolata di invocazione RPC non autorizzata;
i permessi delle RPC sono verificati tramite catalogo e i download tramite HTTP/RLS.
Nexi non raggiunge localhost: la prova reale server-to-server richiede un indirizzo pubblico.


## Invio ricevuta con Resend TEST
Migrazione 016: fiscal_email_jobs, coda persistente con un solo lavoro per documento,
lease di 120 secondi, snapshot immutabile di mittente, destinatario, contenuto e hash PDF.
L'invio parte dopo l'archiviazione del PDF. Nessuna email viene inviata per documenti falliti.
Lo stato email compare in Cassa ed e separato da emissione e pagamento.

~~~dotenv
RESEND_API_KEY=chiave_da_inserire_localmente
RESEND_FROM=onboarding@resend.dev
FISKALY_TEST_EMAIL_TO=indirizzo_autorizzato
FISKALY_TEST_EMAIL_ENABLED=true
~~~
In locale il flag rimane false fino alla configurazione. Il destinatario di prova viene
preso esclusivamente dalla variabile autorizzata, mai dal cliente della prenotazione.
Salvare .env.local e riavviare npm run dev. Il worker inserira anche la ricevuta TEST
completata gia presente, se non ha ancora un lavoro email. Le email sono etichettate TEST,
con PDF dimostrativo allegato. La chiave Resend resta sul server e fuori da Git.

Invii con risposta persa e riprese usano sempre lo stesso payload, PDF e chiave di
idempotenza. Resend conserva le chiavi per 24 ore: dopo 23 ore dal primo tentativo il
job viene fermato in uncertain, da verificare prima di decidere un nuovo invio.
Lo stato sent significa accettato da Resend, non consegna alla casella certificata.
Eventi di delivery/bounce e reinvio manuale non sono implementati in questa fase.

Verifiche: adapter con allegati e chiavi, destinatari TEST, snapshot PDF, errori e retry;
prova PostgreSQL locale con enqueue duplicato, snapshot immutabile, risposta accettata
seguita da errore DB, ripresa con stessa chiave, job sent e blocco oltre la finestra.
Il provider nella prova locale e simulato: nessuna consegna email reale e dichiarata.

~~~powershell
$env:FISCAL_LOCAL_INTEGRATION='true'
node --env-file=.env.local node_modules/vitest/vitest.mjs run scripts/fiscal-email-local.test.ts
Remove-Item Env:FISCAL_LOCAL_INTEGRATION
~~~
La prova richiede coda vuota e rimuove il lavoro temporaneo al termine; non eseguirla
su una coda con invii reali attivi.
Riferimenti: https://resend.com/docs/dashboard/emails/idempotency-keys
https://resend.com/docs/api-reference/emails/send-email


## Prova Resend reale del 2026-10-11
Configurazione locale completata dall'utente e server riavviato. Il worker ha inviato
la ricevuta TEST gia completata con PDF archiviato, ottenendo l'accettazione Resend
al primo tentativo. fiscal_email_jobs registra state=sent, provider_email_id e sent_at,
senza errore. Non e stata creata una nuova ricevuta o avviato un nuovo pagamento.
La consegna alla casella resta da confermare dal destinatario: non e stata verificata
tramite webhook delivery/bounce. La chiave Sending access non viene usata per leggere
lo stato remoto. Non rieseguire la prova email locale simulata sulla coda attiva.


## Cancellazioni e rimborsi integrati TEST (2026-10-11)
Il destinatario ha confermato la ricezione della prima email con PDF TEST.
Migrazione 017: cancellazione appuntamento e richiesta di rimborso atomiche,
refund_jobs con snapshot immutabile, un solo lavoro per pagamento e lease.
La decisione della finestra cliente viene conservata al primo annullo, senza
ricalcolarla durante una ripresa. L'annullo staff usa la policy di rimborso integrale.
Le DELETE staff verificano autenticazione e salone prima dell'azione finanziaria.

Il worker registra l'inizio della chiamata prima di contattare Nexi; verifica MAC,
esito e riferimento operativo della risposta. Un esito OK verificato aggiorna in
transazione pagamento, evento e job. Prima della chiamata una lease scaduta e
recuperabile; dopo l'inizio della chiamata un timeout/crash viene fermato come
uncertain per evitare un doppio rimborso. Un KO firmato viene conservato come failed.
Esiti incerti e rifiuti richiedono verifica/correzione prima di un nuovo tentativo:
la riconciliazione Nexi e il comando staff di ripresa non sono ancora implementati.
Una notifica OK tardiva gia registrata non annulla lo stato refunded.

Per annullo prima dell'inizio e rimborso completo verificato, viene accodato un
CANCELLATION collegato alla ricevuta originale, usando la sua configurazione fiscale
immutabile. L'annullo ha proprie chiavi persistenti, stato e PDF. La ricevuta originale
viene marcata canceled solo dopo COMPLETED/FINISHED dell'annullo e rimane consultabile.
Cassa distingue pagamento, rimborso, documento e email. L'email di annullo usa un
oggetto specifico nelle nuove sessioni del server. Il primo annullo di prova e stato
inviato dal cron gia avviato con oggetto generico Ricevuta TEST; il PDF e quello di annullo.
Riavviare il server per caricare tutti gli aggiornamenti del worker e dei template.

Annullo dopo l'inizio: richiesta monetaria conservata, ma nessun CANCELLATION automatico;
Cassa segnala che il reso fiscale va gestito. CORRECTION e rimborsi parziali restano separati.
Il worker monetario viene attivato esplicitamente con FISKALY_TEST_REFUNDS_ENABLED=true;
per ora resta false: il pagamento del flusso locale era una notifica simulata e non
esiste in Nexi. La prova di un vero rimborso richiede un vero pagamento sandbox e
una notifica raggiungibile su indirizzo pubblico.

Verifiche: 21 controlli PostgreSQL in database temporaneo, test worker/MAC/timeout,
prova locale con risposta Nexi firmata SIMULATA e annullo reale fiskaly TEST
COMPLETED/FINISHED con PDF. Conservati pagamento, appuntamento annullato, ricevuta
originale e annullo; il riferimento monetario inizia con SIMULATED. Nessun rimborso
Nexi remoto e stato effettuato o dichiarato riuscito.

~~~powershell
node scripts/refund-db-verify.mjs
$env:FISCAL_LOCAL_CANCELLATION_TEST='true'
node --env-file=.env.local node_modules/vitest/vitest.mjs run scripts/fiscal-cancellation-local.test.ts
Remove-Item Env:FISCAL_LOCAL_CANCELLATION_TEST
~~~
La prova usa soltanto l'appuntamento locale fittizio identificato nello script e
verifica nelle note che derivi dalla notifica Nexi simulata. Non eseguirla in LIVE.
Riferimenti: https://ecommerce.nexi.it/sites/default/files/documenti/specifichetecniche.NEXI.13.2_0.pdf
https://support.fiskaly.com/hc/en-001/articles/23705053376412-SIGN-IT-When-should-CANCELLATION-be-used


## Callback pubblico temporaneo per Nexi sandbox

Per provare un pagamento sandbox reale con il widget su localhost, impostare
`NEXI_TEST_NOTIFY_URL=https://<tunnel>/api/webhooks/payments/nexi` in `.env.local`.
L'override funziona esclusivamente con `PAYMENT_PROVIDER=nexi` e `NEXI_ENV=test`.
Non impostare `NEXT_PUBLIC_APP_URL` al tunnel: ritorno del browser e conferma
interna dell'appuntamento devono rimanere sull'app locale.

`node --env-file=.env.local scripts/nexi-test-proxy.mjs` avvia su 127.0.0.1:3001
un proxy limitato al POST form-urlencoded del webhook Nexi (massimo 8 KiB).
Cloudflared deve puntare a questa porta, non alla porta dell'app. Le altre
rotte rispondono 404; la verifica MAC rimane nel webhook originale.

Il tunnel avviato durante la preparazione e' temporaneo. Il binario, i log e
`processes.json` con i PID sono sotto `.superpowers/nexi-test`, esclusa da Git.
Alla chiusura del tunnel o al riavvio del PC occorre generarne uno nuovo e
aggiornare l'override prima di avviare altri pagamenti. Riavviare `npm run dev`
dopo ogni aggiornamento di `.env.local`.

Verificati sei test per override e proxy, TypeScript e lint dei file coinvolti.
Dal tunnel verificati 404 sulla pagina calendario e 400 per una notifica con
MAC invalido. Questo verifica la raggiungibilita', non un pagamento Nexi.
Il checkout sandbox completo deve ancora essere effettuato dal browser;
`FISKALY_TEST_REFUNDS_ENABLED` rimane false fino a tale verifica.


## Deploy sul server di testing

Da main, con modifiche tracciate gia committate, eseguire da PowerShell:
`./scripts/deploy-test.ps1`. Lo script trasferisce soltanto il contenuto del commit
con `git archive`, non i file locali extra. La configurazione fiscale TEST viene
esportata da `.env.local` in un file privato temporaneo e trasferita via SSH;
Supabase, DATABASE_URL, Nexi e CRON_SECRET del server vengono conservati.
Il callback temporaneo locale viene rimosso dalla configurazione del server.

Release: `/opt/localvista-releases/<commit>`; release attiva indicata da
`/opt/localvista-releases/current`. Le variabili pubbliche Supabase vengono passate
alla build; `.env*` e il file di configurazione privata sono esclusi dall'immagine.
Le chiavi server sono fornite al container solo durante l'avvio.

Il backup conserva immagine precedente, configurazione precedente e un dump
PostgreSQL 17 delle tabelle public e dei metadati storage. Non copia i file binari
dei bucket o lo schema auth. Le migrazioni 014-017 e la configurazione del salone
vengono applicate in una transazione; un registro privato conserva i checksum per
non applicarle due volte. La build precede le migrazioni e non ferma l'app attuale.
Un avvio fallito ripristina l'immagine precedente; le migrazioni additive restano.
Per ripristino manuale usare `docker compose -p gestionale-parrucchiere -f
<backup>/rollback-compose.json up -d --no-build nextjs`. Non ripristinare il dump
senza verificare eventuali nuove operazioni registrate dopo il deploy.

Il primo deploy lascia `FISKALY_TEST_REFUNDS_ENABLED=false`: l'attivazione segue
la verifica di una nuova prenotazione con pagamento realmente eseguito in sandbox.
I pagamenti gia presenti sul server non vengono retrofatturati automaticamente.


## Cambio data cliente (migrazione 018)

Le conferme e i promemoria includono Modifica data e ora con un token HMAC distinto
da quello di disdetta. Anche la pagina del vecchio link di disdetta offre lo
spostamento per gli appuntamenti ancora attivi. Un appuntamento annullato,
completato o iniziato non viene riattivato.

Il cliente sceglie un nuovo slot entro 365 giorni, per lo stesso servizio e
operatore. Durata, buffer, identita dell'appuntamento, pagamento e ricevuta
rimangono invariati. API e database verificano conflitti, blocchi e checkout
pending; le scritture del calendario condividono un lock del salone per impedire
che una prenotazione concorrente occupi lo slot appena spostato. Le fasi di posa
mantengono la semantica del motore esistente. Richieste duplicate riutilizzano
la stessa chiave, richieste basate su una vecchia data richiedono un aggiornamento.

Il termine di rimborso non viene prorogato posticipando l'appuntamento. Se viene
anticipato, il termine puo anticiparsi; la disdetta staff mantiene la policy
esistente. La pagina e le mail di disdetta usano la decisione effettiva, senza
attribuire automaticamente un mancato rimborso alla distanza dalla nuova data.

Uno storico server-only registra ogni cambio e accoda la mail con il nuovo orario.
Il worker usa una chiave Resend stabile, lease e tentativi limitati; non reinvia
alla cieca oltre la finestra di idempotenza. I cambi superati da un altro cambio
o da una cancellazione non generano notifiche obsolete. I promemoria vengono
riarmati sulla nuova data. Gli aggiornamenti GHL/Treatwell e n8n riutilizzano le
integrazioni esistenti; i loro errori rimangono nel relativo sync_log.

Verifiche: `node scripts/reschedule-db-verify.mjs`, suite Vitest e build Next.js.
Il deploy include 018 nel registro delle migrazioni e conserva anche il registro
privato nel backup. Per la prova dal browser creare una nuova prenotazione sandbox:
quella cancellata il 2026-10-11 rimane annullata.


## Cassa dall'appuntamento e preventivi (migrazione 019)

Nella card espansa compare un solo pulsante LogIn (freccia verso parentesi),
con menu al passaggio del mouse, al clic e da tastiera. Le opzioni aprono una
finestra ampia: Vai alla cassa oppure Crea preventivo. Salvare prima eventuali
modifiche dell'appuntamento: la finestra usa dati gia persistiti.

Cassa: voci dal servizio principale e dagli aggiuntivi presenti nel listino,
quantita intere, prezzi e sconti in centesimi. Importi IVA inclusa, IVA TEST della
configurazione server. Il riepilogo richiede una conferma esplicita dell'incasso.
Contanti e POS esterno sono registrati in salon_sales, senza fingere una
transazione Nexi e senza comandare il terminale. Incasso, snapshot immutabile,
documento fiscale e job vengono salvati in una transazione. Il worker fiscale,
l'archiviazione PDF privata e Resend sono gli stessi del flusso online.

Un solo incasso in salone per appuntamento in questa fase. Pagamenti online
riusciti, rimborsati, autorizzati o ancora in attesa e documenti gia associati
impediscono una nuova emissione manuale. Un pagamento ambiguo va verificato,
anche se vecchio. Un errore fiscale conserva l'incasso, senza una seconda
emissione tramite un nuovo clic. LIVE rimane bloccato.

Preventivi: una bozza per appuntamento, con numero, versione, scadenza, cliente
e salone fotografati al salvataggio. Il PDF viene generato dal server dal
contenuto salvato, non dal carrello non salvato. La pagina Cassa ha la scheda
Preventivi, con apertura e download. La conversione usa il preventivo salvato,
controlla versione e scadenza, registra l'incasso e rende il preventivo immutabile.
Non genera un pagamento o un documento fiscale finche non viene incassato.

L'annullo di un appuntamento con incasso in salone marca l'operazione come
review_required. Cassa e le schermate di disdetta segnalano la verifica manuale:
non viene simulato un rimborso Nexi o un annullo fiscale. Restano da estendere
la gestione di resi e rimborsi per contanti/POS, gli acconti/saldi, i pagamenti
misti, i prodotti e la fattura elettronica SdI.

Verifiche: `node scripts/checkout-db-verify.mjs`, test basket/API/PDF e suite
esistente. Emissione isolata con piu voci, quantita e sconto su fiskaly TEST:
record 01a15103-0dff-7380-9599-30bd41cbe6a8 COMPLETED/FINISHED. Questa prova non
registra un incasso nel gestionale e non invia mail.


## Credito nominativo, promozioni e magazzino (migrazione 020)

Il menu Credito e promozioni e il pulsante Credito e premi nella scheda cliente
aprono saldo, ultime 100 movimentazioni e premi assegnati. Ricariche e utilizzi
sono denaro prepagato; le promozioni riducono il prezzo del servizio e non creano
credito. Solo owner/admin assegnano o revocano premi e configurano le regole;
owner/admin/receptionist registrano incassi. Tutte le scritture passano dalle
API autenticate e da RPC revocate ad anon/authenticated.

Il programma fedelta e inizialmente disattivato. Una regola configurabile conta
visite completate e terminate, successive alla propria attivazione, eventualmente
per un servizio specifico. Ogni soglia raggiunta genera un premio unico, usabile
su una visita successiva. Cambio di stato e richieste simultanee non duplicano i
premi. Visite annullate non qualificano un premio ancora inutilizzato. Sostituire
la regola avvia un nuovo conteggio. Premi manuali hanno percentuale (1-90%) oppure
importo fisso, servizio facoltativo e scadenza facoltativa; non sono cumulabili con
altri sconti. L'importo fisso e limitato al prezzo della voce meno un centesimo:
la gestione fiscale di omaggi al 100% resta fuori da questa versione.
Non viene implementato un incentivo alle recensioni Google: Google vieta premi
in cambio di recensioni (https://support.google.com/contributionpolicy/answer/7400114).

Prodotti e magazzino sono predisposti ma la vendita e disabilitata per default.
Un amministratore puo abilitarla, creare prodotti, aggiornare prezzi e registrare
carichi/rettifiche con motivo. La conferma della vendita scala le quantita;
preventivi e carrelli aperti non modificano il magazzino. Scorte e credito vengono
verificati e movimentati atomicamente con la vendita, il premio e la coda fiscale.
Le operazioni finanziarie sono serializzate per salone con advisory lock.
Gli appuntamenti gia pagati ammettono vendite aggiuntive di soli prodotti, senza
ricaricare il servizio. La vendita di soli prodotti e la ricarica funzionano
anche senza appuntamento. Il preventivo salvato resta convertibile, anche con
credito; per cambiare le voci o applicare una promozione si prepara prima un nuovo
preventivo. Il widget online continua a usare Nexi come prima.

Politica fiscale limitata al TEST: buono monouso nominativo con IVA 22% alla
ricarica. Il credito copre solo carrelli con IVA 22%; altri prodotti supportano
4/5/10/22% senza credito. La redemption segue la guida SIGN IT lite
https://support.fiskaly.com/hc/en-001/articles/22282230118556
con distribuzione del credito sulle righe. Copertura integrale: workaround
fiskaly di un centesimo sulla riga e sconto di pagamento corrispondente; il totale
incassato resta zero. Non e una configurazione fiscale LIVE: la classificazione
del buono e il trattamento definitivo vanno validati con il commercialista.

Il registro vendite distingue valore della vendita, credito utilizzato e nuovo
incasso. I riepiloghi escludono gli storni e non contano il credito usato come
nuovo denaro ricevuto. L'annullo integrale TEST e disponibile nella stessa
giornata, solo dopo l'emissione, con conferma del rimborso manuale e restituzione
facoltativa dei prodotti al magazzino. Ripristina il credito consumato; annullare
una ricarica richiede saldo sufficiente. Il premio usato resta nello storico e
puo essere riassegnato esplicitamente. L'annullo fiscale segue la coda persistente:
un suo errore non ripete i movimenti. Resi parziali o di giornate successive
richiedono un flusso fiscale ulteriore. Nessun comando viene inviato al POS.

Le richieste con esito incerto restano in sessionStorage con UUID stabile e una
azione di ripresa; i problemi di rete non vengono trattati come rifiuti definitivi.
Verifiche: node scripts/commerce-db-verify.mjs (database effimero), test Vitest
commerce, TypeScript/lint, prove browser desktop/mobile. Prove isolate fiskaly
COMPLETED/FINISHED: ricarica 01a1517c-b7f8-7948-9590-5275bfd39788,
credito completo 01a1517b-d749-73d6-9421-78fa2e1b60b9,
credito+POS 01a1517c-b356-7dd2-8491-88ced0ef0dac.


## Incasso unico di appuntamenti nella stessa giornata

La migrazione `021_grouped_checkout.sql` introduce `salon_sale_appointments`, con un collegamento immutabile e univoco per ogni appuntamento incassato. Recupera anche le vendite precedenti, senza emettere nuovi documenti. Una vendita cumulativa conserva un solo movimento economico, un documento e un lavoro fiscale; tutti gli appuntamenti inclusi rimandano allo stesso documento in Cassa e nel calendario.

Dalla Cassa di un appuntamento lo staff può selezionare altri appuntamenti dello stesso cliente e della stessa giornata in Europe/Rome (massimo 20 appuntamenti, 30 voci). Appuntamenti annullati, pagamenti online riusciti/rimborsati o in attesa, incassi già registrati e documenti già presenti non sono selezionabili. Il database ricontrolla identità, giornata, revisione e stato sotto lock, incluse le richieste provenienti dal vecchio checkout. Gli appuntamenti senza anagrafica cliente restano singoli.

I prezzi e gli sconti del carrello sono verificabili prima della conferma. Le promozioni si applicano una sola volta secondo la regola esistente; il credito viene addebitato una sola volta per l'intero incasso. Il recupero di una richiesta con esito incerto conserva tutti i membri e la stessa chiave di idempotenza, anche dopo un ricaricamento del browser. I preventivi salvati si convertono nel flusso singolo; un incasso cumulativo usa gli importi confermati in Cassa e segnala la presenza di preventivi da verificare.

L'annullo integrale TEST riguarda l'intera vendita cumulativa. Annullare un singolo appuntamento segnala l'incasso condiviso come da verificare, senza rimborsare automaticamente gli altri servizi. Restano necessari flussi dedicati per resi parziali e il passaggio LIVE.

Verifica transazionale isolata: `node scripts/grouped-checkout-db-verify.mjs`. Non chiama Nexi, fiskaly o Resend e rimuove il database temporaneo al termine.


## Prenotazione di più servizi dal widget

Il widget accetta da 1 a 10 servizi distinti in un unico appuntamento con lo stesso operatore, qualificato per tutti i servizi. Prezzi, durata e buffer vengono verificati sul server. Le fasi tutte a zero non sostituiscono più la durata principale del servizio. Il riepilogo mostra la durata dei servizi; la disponibilità riserva anche i buffer interni e richiede uno spazio continuo sufficiente.

La migrazione `022_widget_service_bundles.sql` aggiunge `appointments.booked_services`, conservando i servizi successivi anche in `added_services` per compatibilità con il calendario. Un pagamento contiene uno snapshot di tutte le voci e produce un solo documento commerciale TEST, con una riga per servizio. La conferma usa lo snapshot salvato al checkout: cambi successivi al listino non modificano prezzo, nomi o durata acquistati. I vecchi pagamenti senza snapshot rimangono compatibili.

Le prenotazioni simultanee sono serializzate tramite il lock del calendario. I pagamenti pending scadono dopo 15 minuti; i pagamenti riusciti senza appuntamento collegato continuano a riservare lo spazio durante il recupero della conferma via webhook. Lo spostamento conserva durata e buffer. Il widget continua a richiedere pagamento online dell'intero importo; credito cliente e promozioni restano nel flusso della cassa staff.

Verifiche: `npx vitest run --exclude '**/.superpowers/**'`, `node scripts/widget-booking-db-verify.mjs` (database Docker temporaneo, senza richieste fiscali o pagamenti esterni). Il deploy applica la migrazione prima dell'avvio della nuova immagine.
