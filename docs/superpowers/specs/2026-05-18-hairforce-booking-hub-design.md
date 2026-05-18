# Hairforce Booking Hub — Design Spec

## Overview

Piattaforma gestionale per parrucchieri multi-salone. Il sistema offre un booking system proprietario con calendario unificato, sincronizzazione bidirezionale con Treatwell (fase ponte) e integrazione con GoHighLevel (backbone CRM) e n8n (automazioni). Obiettivo strategico: sostituire Treatwell come piattaforma operativa, eliminando le commissioni.

## Stack Tecnologico

- **Frontend + API**: Next.js 14 (App Router) con TypeScript
- **Database**: Supabase (PostgreSQL) con RLS per multi-tenancy
- **Real-time**: Supabase Realtime (basato su pg_notify)
- **Hosting**: Vercel (frontend + API routes), o VPS se si preferisce controllo costi
- **Integrazioni esterne**: Treatwell API (reverse-engineered), GHL Agency API, n8n webhook

## Architettura

Monolite modulare Next.js con 3 service worker in `src/services/`. Comunicazione via Supabase. Pronto per estrazione in microservizi.

```
Booking Widget → Next.js App → Supabase (DB + Auth + RLS)
                    ↕
         ┌─────────┼─────────┐
    Treatwell Sync  Booking Engine  GHL Sync
         ↕                             ↕
    Treatwell API                GHL Agency API
                                     ↕
                                 n8n (webhook)
```

### Service Workers (moduli in `src/services/`)

1. **Treatwell Sync** (`src/services/treatwell-sync/`)
   - Polling periodico 90-150s (con jitter random) solo in fascia 08:00-21:30
   - Write-back istantaneo su Treatwell dopo ogni nostra prenotazione
   - Check disponibilità slot su Treatwell prima di ogni nostra prenotazione
   - Fuori orario operativo (21:30-08:00): nessuna richiesta a Treatwell
   - Massimo 1 richiesta in-flight per salone
   - User-Agent da browser reale per evitare blocchi
   - Retry con backoff esponenziale su 429

2. **Booking Engine** (`src/services/booking-engine/`)
   - Calcolo disponibilità oraria dal nostro DB (non Treatwell)
   - Anti double-booking: lock ottimistico su slot
   - Mapping servizi 1:1 con Treatwell (stessi nomi, stessi ID)
   - Supporto multi-canale: widget, manuale, telefono, Google, Treatwell, WhatsApp, walk-in

3. **GHL Sync** (`src/services/ghl-sync/`)
   - Push contatti nuovi verso sub-account GHL corretto
   - Push appuntamenti verso GHL
   - Routing automatico per sub-account (un sub-account per salone)
   - Unico account GHL agency come ombrello

## Modello Dati

### Entità Core

**salons** — Root multi-tenancy. Ogni riga è un salone indipendente.
- `id`, `name`, `slug`, `address`, `phone`, `timezone`
- `ghl_subaccount_id` — sub-account GHL corrispondente
- `treatwell_salon_id` — ID su Treatwell (nullable, solo se il salone usa Treatwell)
- `treatwell_api_enabled` — flag che attiva il polling Treatwell per questo salone

**users** — Staff e amministratori del salone.
- `id`, `salon_id`, `email`, `role` (owner|admin|stylist|receptionist), `full_name`
- Autenticazione via Supabase Auth

**services** — Catalogo servizi, mirror 1:1 da Treatwell.
- `id`, `salon_id`, `name`, `duration_minutes`, `price_cents`, `color_hex`
- `treatwell_service_id` — chiave di mapping con Treatwell
- Sincronizzato in lettura da Treatwell ogni 6 ore

**clients** — Anagrafica clienti. **Il master data è GHL** — questa tabella è una cache read-only popolata da GHL Sync.
- `id`, `salon_id`, `first_name`, `last_name`, `phone`, `email`
- `ghl_contact_id` — ID primario su GHL (source of truth)
- `treatwell_client_id` — se il cliente proviene da Treatwell

**appointments** — Tabella centrale. **Source of truth = nostro DB.**
- `id`, `salon_id`, `client_id`, `stylist_id`, `service_id`
- `start_time`, `end_time`
- `status` (confirmed|cancelled|no_show|completed)
- `source` (widget|manual|phone|google|treatwell|walk_in|whatsapp)
- `treatwell_appointment_id` — per deduplica sync Treatwell
- `ghl_appointment_id` — per sync GHL

**time_blocks** — Blocchi orari (pause, ferie, chiusure).
- `id`, `salon_id`, `stylist_id` (nullable = tutto il salone), `start_time`, `end_time`, `reason`

**sync_log** — Audit trail di tutte le operazioni di sync.
- `id`, `salon_id`, `direction` (treatwell→us|us→treatwell|us→ghl), `appointment_id`
- `status` (success|failed|conflict|pending_retry), `external_id`, `error_message`, `retry_count`

### Sicurezza Multi-Tenancy

- RLS su ogni tabella: `WHERE salon_id = current_user_salon_id()`
- Admin/Owner: CRUD completo sul salone
- Stylist: lettura propri appuntamenti + clienti
- Receptionist: CRUD su appuntamenti, lettura clienti
- Widget pubblico: INSERT su appointments, SELECT su services e slot liberi

### Indici

- `appointments(salon_id, start_time)` — range query calendario
- `appointments(stylist_id, start_time)` — disponibilità operatore
- `appointments(treatwell_appointment_id)` — deduplica sync
- `sync_log(salon_id, created_at)` — audit

## Flusso Prenotazione (Anti-Conflitto)

### Prenotazione dal nostro Widget
1. Cliente sceglie servizio, data, orario, operatore sul widget
2. Widget interroga nostro DB per slot liberi (non Treatwell)
3. Alla conferma, l'API route esegue in sequenza:
   - Check disponibilità su Treatwell (1 richiesta API)
   - Se slot libero: INSERT su appointments (nostro DB)
   - Write-back immediato su Treatwell (1 richiesta API)
   - Se write-back fallisce: sync_log.status='pending_retry', riprovato con backoff esponenziale (max 5 tentativi)
   - Registrazione su sync_log
   - Notifica a GHL Sync + n8n webhook
4. Conferma al cliente via SMS/WhatsApp (gestito da GHL/n8n)

### Prenotazione arrivata da Treatwell Marketplace
1. Treatwell Sync (polling 90-150s) rileva nuovo appuntamento
2. Deduplica via `treatwell_appointment_id`
3. Se nuovo: INSERT su appointments con `source='treatwell'`
4. Blocca automaticamente lo slot nel nostro calendario
5. Crea/aggiorna record cliente se necessario
6. Notifica GHL Sync

### Gestione Conflitti
- Se Treatwell Sync trova uno slot già occupato → sync_log.status='conflict'
- Il conflitto viene notificato in dashboard al gestore
- Risoluzione manuale: tenere appuntamento nostro o annullare Treatwell

## Interfaccia Calendario

### Vista Giorno (default)
- Griglia a colonne: ora a sinistra, N colonne per N operatori
- Appuntamenti colorati per tipo servizio
- Badge canale su ogni appuntamento (widget, treatwell, telefono, etc.)
- Sync status icon: ✓ syncato, ⟳ pending retry, ✗ errore
- Drag & drop per spostare appuntamenti
- Click su appuntamento → scheda rapida cliente

### Viste
- Giorno / Settimana / Mese — navigazione con frecce o date picker
- Toggle visibilità per operatore
- Filtro per servizio o canale

### Creazione Appuntamento (lato gestore)
- Click su slot libero → modale rapida
- Campi: cliente (autocomplete), servizio (dropdown), operatore, data/ora, note
- Il sistema calcola automaticamente `end_time`

## Booking Widget (Cliente)

### Design
- Mobile-first, 3 step: servizio → data/ora/operatore → dati personali
- URL: `hairforce.app/book/<salon-slug>`
- Deep link supportato: `?service=taglio-donna`
- Embedded via iframe o Web Component
- Nessuna autenticazione richiesta per il cliente

### Distribuzione
- Link WhatsApp (messaggio automatico via GHL)
- Embed su sito del salone
- Link nel profilo Google Business
- QR code fisico in negozio

## Integrazione GHL

- Un account GHL agency → N sub-account (uno per salone)
- GHL Sync pusha: contatti nuovi, appuntamenti nuovi/modificati
- GHL gestisce: automazioni SMS/WhatsApp, voice agent per chiamate perse, funnel marketing
- I dati cliente su GHL sono il master — la nostra tabella `clients` è cache read-only

## Integrazione n8n

- Webhook in uscita dal nostro sistema su eventi chiave:
  - `appointment.created`
  - `appointment.cancelled`
  - `appointment.no_show`
  - `client.created`
- n8n riceve il webhook e orchestra le automazioni su GHL (invio SMS, trigger voice agent, aggiornamento funnel)

## Limiti di Riferimento

- Finestra sync Treatwell: 08:00–21:30
- Polling interval: 90-150 secondi (jitter random)
- Polling catalogo servizi: ogni 6 ore
- Massimo 1 richiesta in-flight per salone verso Treatwell
- User-Agent browser reale, IP dedicato per salone
- Fuori finestra: zero richieste a Treatwell

## Cosa Resta Fuori da Questa Fase

- Vista multi-salone centralizzata
- Gestione finanziaria (fatturato, report)
- Gestione prodotti e magazzino
- Gestione clienti avanzata (il master è GHL)
- Prenotazione ricorrente
- Notifiche push native (gestite da GHL)
