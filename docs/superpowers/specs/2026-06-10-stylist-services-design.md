# Stylist-Services Assignment

**Data:** 2026-06-10  
**Stato:** Approved

## Contesto

Attualmente ogni stylist può eseguire qualsiasi servizio. Nella realtà uno stylist è specializzato solo in alcuni trattamenti (taglio, colore, piega). Questa feature permette di assegnare servizi specifici a ogni stylist.

## Regola di default

Se uno stylist ha **zero righe** in `stylist_services` → può fare **tutti** i servizi (retrocompatibile con i dati esistenti). Appena gli viene assegnato almeno un servizio, **solo quelli** sono validi.

## Database

Nuova migration `007_stylist_services.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.stylist_services (
  stylist_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (stylist_id, service_id)
);

ALTER TABLE public.stylist_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "StylistServices read salon" ON public.stylist_services FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = (
    SELECT salon_id FROM public.users WHERE id = stylist_services.stylist_id
  )));

CREATE POLICY "StylistServices write admin" ON public.stylist_services FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('owner', 'admin')));

CREATE POLICY "StylistServices delete admin" ON public.stylist_services FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('owner', 'admin')));
```

## API

### `GET /api/stylist-services?salon_id=X&stylist_id=Y`
Restituisce i `service_id` assegnati allo stylist.

### `POST /api/stylist-services`
Body: `{ salon_id, stylist_id, service_ids: string[] }`  
Sostituisce atomicamente: cancella tutte le righe esistenti per quello stylist, inserisce i nuovi `service_ids`.

### `GET /api/stylist-services?salon_id=X&service_id=Y`
Restituisce `stylist_id` che possono fare quel servizio. Se vuoto → significa che NESSUNO stylist ha assegnazioni esplicite, quindi TUTTI possono farlo.

## Modifiche esistenti

### `fetchStylists()` in `src/services/booking-engine/queries.ts`
Aggiungere parametro `service_id?: string`. Se fornito:
1. Query su `stylist_services` per trovare stylist con almeno un'assegnazione
2. Se la query restituisce risultati → filtra solo quegli stylist
3. Se la query è vuota → nessuno ha assegnazioni, tutti possono fare tutto (default)

### `GET /api/slots`
Passa `service_id` a `fetchStylists()`.

## Frontend

### Pagina Staff (`staff/page.tsx`)
Sezione "Servizi" sotto gli orari quando uno stylist è espanso:
- Checkbox per ogni servizio del salone
- "Salva servizi" button indipendente da "Salva orari"
- Se nessuna checkbox è spuntata → label "Tutti i servizi"

### Pagina Servizi (`services/page.tsx`)
Card servizio diventa cliccabile per espandere:
- Mostra checkbox per ogni stylist
- Stessa tabella `stylist_services`, vista dall'angolo opposto

### Widget prenotazione (`book/[salon]/page.tsx`)
Nessuna modifica visiva. La lista stylist è già filtrata dall'API slots.

### Modale appuntamento (`AppointmentModal.tsx`)
La dropdown "Operatore" si filtra in base al servizio selezionato.
Quando si cambia servizio, resettare lo stylist se non è più valido.

## Verifica

1. `npx tsc --noEmit` — zero errori TypeScript
2. `npm run build` — build completata
3. Test manuale: assegnare solo "Taglio Uomo" a Marco → widget mostra Marco solo per Taglio Uomo, non per Colore
4. Test default: nuovo stylist senza assegnazioni → può fare tutti i servizi
