# Mancata presenza — ambiente TEST

La presenza regolare è implicita: lo staff non deve completare o confermare ogni card. L'azione “Mancata presenza” nella card è disponibile dopo la fine dell'ultimo appuntamento contiguo dello stesso cliente e salone. Gli intervalli comprendono i buffer già riservati; una prenotazione annullata non collega due visite. È possibile selezionare solo alcuni servizi della sequenza. Orari, pagamenti, ricevute, crediti e rimborsi non vengono modificati.

“Rimuovi mancata presenza” ripristina lo stato precedente (confirmed oppure completed), senza spostare gli orari. Cancella la comunicazione ancora in attesa se non restano assenze dello stesso cliente quel giorno. Lo storico della scheda cliente conserva visita, servizi, segnalazioni, correzioni e autore. Un messaggio già accettato dal provider non può essere ritirato.

## Automazioni

- Recensioni: attendono almeno un'ora dalla fine dell'intera sequenza; il cron giornaliero passa ogni minuto. La verifica immediatamente prima dell'invio esclude no_show e cancelled. Anche confirmed è idoneo, senza intervento dello staff.
- Mancata presenza: una email per salone, cliente e giorno della visita (Europe/Rome), dopo 30 minuti dall'ultima segnalazione, elaborata ogni minuto. Il ripristino prima dell'invio la annulla. Lo stesso giorno non genera una seconda email se la precedente è stata inviata o ha un esito incerto.
- Telefono senza email: segnalazione registrata e messaggio “Email assente”; nessun SMS. Non è configurato alcun provider SMS.
- I dati e il destinatario del messaggio vengono congelati al primo tentativo; retry con la stessa chiave Resend e blocco entro 23 ore. Un timeout dopo accettazione non deve produrre una nuova email. Dopo cinque errori l'esito richiede verifica.
- TEST: destinatario esattamente uguale a NO_SHOW_EMAIL_TEST_TO (fallback FISKALY_TEST_EMAIL_TO), senza inoltrare messaggi di altri clienti a quell'indirizzo. NO_SHOW_EMAIL_MODE=test; NO_SHOW_EMAIL_ENABLED=false sospende il worker. Le chiavi restano sul server.

## Database e distribuzione

Migrazione 023_no_show_visits.sql: storico, membri, eventi immutabili, coda persistente; RLS per salone e RPC disponibili solo al server. La modifica verifica autore, salone, fine della visita e versioni di tutti i membri in transazione. Le assenze precedenti vengono importate senza inviare email arretrate. Il deploy aggiorna solo il gestionale e mantiene la build sul PC.

Verifiche: npm test; npx tsc --noEmit --incremental false; node scripts/no-show-db-verify.mjs (Docker Supabase locale). Quest'ultimo crea e rimuove un database temporaneo, senza cambiare dati del salone o inviare email.

## Prova manuale

1. Aprire una visita conclusa, espandere “Mancata presenza” e scegliere i servizi effettivamente saltati. Su una sequenza ancora in corso il comando resta disabilitato.
2. Verificare il badge “Assente”, lo storico nella scheda cliente e lo stato dell'email. Una visita pagata online mantiene pagamento e documento.
3. Rimuovere la segnalazione entro 30 minuti e verificare l'annullamento del messaggio. Ripristinando la visita tornano idonee le automazioni non già inviate.
4. Per provare la consegna, usare il destinatario autorizzato Resend TEST e lasciare una segnalazione valida in attesa. Non servono credenziali SMS.

## Recensioni e promemoria giornalieri

Il raggruppamento giornaliero di recensioni e promemoria è implementato dalla migrazione 024_daily_notifications.sql. Vedere [automazioni giornaliere](daily-notifications-test.md). Le visite regolari continuano a non richiedere conferme dello staff. SMS, blacklist, lista d’attesa, penali e link per prepagare restano esclusi.
