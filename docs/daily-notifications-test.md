# Promemoria e recensioni giornalieri — TEST

Una registrazione persistente per salone, cliente, giorno italiano della visita e tipo di email. Le prenotazioni contigue e quelle separate nella stessa giornata appartengono allo stesso riepilogo. L’identità è quella della scheda cliente: due schede diverse non vengono fuse solo perché condividono un indirizzo email.

## Regole operative

- Promemoria unico circa due ore prima del primo appuntamento valido. Elenca tutti i servizi della giornata, con orari, operatori e collegamenti individuali per modificare o annullare ciascuna prenotazione. Sostituisce i promemoria per singolo appuntamento.
- Richiesta di recensione unica almeno un’ora dopo l’ultimo appuntamento valido, recuperabile entro 24 ore dalla sua fine. Il cron controlla ogni minuto. Nessuna conferma di presenza richiesta: confirmed e completed sono entrambi idonei; cancelled e no_show vengono esclusi.
- Se tutte le visite della giornata risultano annullate o assenti, la recensione non parte. Il ripristino di un’assenza riabilita una richiesta ancora mai tentata, finché la finestra è valida.
- Spostamenti/cancellazioni/nuovi servizi aggiornano il messaggio ancora da inviare. Dopo un invio accettato, la stessa giornata non produce un secondo messaggio dello stesso tipo, anche se si aggiunge una prenotazione. Un altro giorno ha un conteggio indipendente.
- Conferme, cancellazioni e comunicazioni di modifica rimangono legate alla singola operazione. L’email giornaliera di mancata presenza resta nel modulo assenze. Nessun SMS.
- Se una modifica avviene quando l’invio è già stato tentato, il messaggio viene fermato con esito da verificare. Non si cambia il contenuto associato alla stessa chiave Resend. Un’email già accettata non può essere ritirata.

## Consegna e configurazione

Il worker gira in TEST con DAILY_EMAIL_MODE=test e DAILY_EMAIL_ENABLED=true. DAILY_EMAIL_TEST_TO identifica il destinatario autorizzato, con fallback FISKALY_TEST_EMAIL_TO. Gli altri indirizzi risultano bloccati: nessun inoltro verso l’indirizzo di prova. Cliente senza email: stato esplicito senza tentativi SMS. Si riusano RESEND_API_KEY, RESEND_FROM, NEXT_PUBLIC_APP_URL, CRON_SECRET e REVIEW_URL già presenti; se REVIEW_URL manca, la recensione invita a rispondere all’email, come in precedenza.

Al primo tentativo si salvano destinatario, mittente, testo, HTML e link. Un lease consente un solo worker alla volta. Retry con lo stesso payload e la stessa chiave, entro 23 ore dal primo tentativo; dopo cinque errori l’esito resta da verificare. Non viene dichiarata consegna quando non si conosce l’accettazione del provider.

La scheda cliente mostra “Promemoria e recensioni”: stato, giornata della visita, orario previsto o invio effettuato. Lo storico si aggiorna mentre è aperto. Sono visibili le ultime 100 comunicazioni; i link firmati e i payload completi non vengono esposti dall’API dello storico.

## Migrazione e recupero

024_daily_notifications.sql importa le notifiche già inviate, usando lo storico degli spostamenti disponibile per ricostruire la giornata originaria. Un trigger registra anche eventuali vecchi invii già in corso durante il cambio versione. Il vecchio cron per appuntamento viene disabilitato al confine database per promemoria e recensioni; le conferme rimangono abilitate.

Il rollback alla vecchia immagine mantiene prudenzialmente sospesi i vecchi promemoria/recensioni per appuntamento. Per riprendere il flusso usare una versione compatibile con la coda giornaliera: non riabilitare il vecchio cron senza riconciliare lo storico.

## Verifica

npm test; npx tsc --noEmit --incremental false; node scripts/daily-notifications-db-verify.mjs. Lo script SQL crea un database locale temporaneo e lo rimuove, senza alterare il salone o inviare email. Copre giornata completa, ore legali/solari, più operatori, legacy, invii simultanei, timeout, riavvio, modifiche in volo, no_show/ripristino e isolamento tra saloni.
