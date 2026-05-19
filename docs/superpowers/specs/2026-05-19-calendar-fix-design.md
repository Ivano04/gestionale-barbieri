# Phase 1 — Stabilize Core & UX — Design Spec

**Date**: 2026-05-19
**Status**: Approved
**Parent Vision**: [Hairforce Booking Hub](./2026-05-18-hairforce-booking-hub-design.md)

## Product Vision

**LocalVista Gestionale Parrucchieri** — un "Treatwell 2.0 ibrido" multisalone.

- Booking system proprietario con calendario unificato (indipendente da Treatwell)
- Connessione a **GoHighLevel** (CRM backbone: contatti, appuntamenti, automazioni SMS/WhatsApp)
- Connessione a **n8n** (webhook per automazioni: `appointment.created`, `appointment.cancelled`, `client.created`)
- Integrazione **Treatwell** in lettura (reverse-engineered API) per onboardare clienti dal marketplace
- L'integrazione Treatwell è SECONDARIA — l'app deve funzionare in maniera perfetta da sola per tutte le funzioni base

## Phase 1 Goal

Prima di espandere integrazioni e multi-salone: rendere il core PERFETTO. Calendario, booking, clienti, servizi devono funzionare senza bug e con UX eccellente. Le integrazioni (Treatwell, GHL, n8n) restano attive ma non vengono modificate in questa fase.

**Principio**: Non rifare da zero. Costruire sulla direzione già presa nei deployment recenti: mobile-first responsive, week view raffinata, ore passate grigie, protezioni blocchi, hydration-safe rendering.

## 1. Timezone & Date Utils

**Problema**: `+02:00` hardcodato in slots API, calendar page, modal. D'inverno (`+01:00`) tutti gli orari shiftano di 1 ora.

**Soluzione**:
- DB: già in UTC con offset nelle stringhe ISO — nessun cambiamento
- Server: usare `parseISO` da `date-fns` che gestisce l'offset automaticamente, rimuovere tutti gli `+02:00` hardcodati
- Client: dove serve costruire una data da `"14:00"` (senza offset), derivare l'offset dal browser con `new Date().getTimezoneOffset()`
- Nuovo `lib/date-utils.ts` con helper centralizzati:
  - `toLocalTimeString(iso: string): string` — formatta HH:mm nel timezone locale
  - `buildSlotTime(dateStr: string, time: string): string` — costruisce ISO string con offset corretto
  - `isPastSlot(dateStr: string, time: string): boolean` — confronto timezone-aware

**File toccati**: `lib/date-utils.ts` (nuovo), `api/slots/route.ts`, `calendar/page.tsx`, `calendar/components/AppointmentModal.tsx`

## 2. Unified Booking Engine

**Problema**: Logica slot duplicata in `services/booking-engine/availability.ts` (vecchia, hardcoded 08:00-20:00) e `api/slots/route.ts` (nuova ma buggata).

**Soluzione**: Modulo unico `services/booking-engine/` come fonte della verità:
- `index.ts` — `getAvailableSlots(params)` unica funzione pubblica
- `queries.ts` — fetch Supabase (appuntamenti, blocchi, servizi, orari)
- `overlap.ts` — funzioni pure: `isOverlap()`, `generateSlots()`

Consumer:
- `api/slots/route.ts` → chiama `getAvailableSlots()`
- `api/book/[salon]/route.ts` → userà `getAvailableSlots()` per mostrare slot nel widget

**File toccati**: `services/booking-engine/*` (refactor), `api/slots/route.ts` (semplifica), elimina `availability.ts`

## 3. State Management & Sync

**Problema**: Ogni pagina fetcha autonomamente, creare/modificare un appuntamento non aggiorna le altre pagine.

**Soluzione**: Custom hook `useCalendarData(salonId, date)`:
- Centralizza fetch di appointments, services, clients, stylists, timeBlocks, salonHours
- Refresh automatico su `window focus` (già testato nella dashboard)
- Espone `refresh()` chiamato dopo ogni mutazione (save/delete)
- Toast su errori fetch (non più silenziosi)

**File toccati**: `lib/hooks/useCalendarData.ts` (nuovo), `calendar/page.tsx` (usa hook)

## 4. Calendar UX

**Base di partenza**: DayView e WeekView già esistenti con mobile-first responsive, ore passate grigie, protezioni blocchi. MonthView rimosso — non serve.

**Miglioramenti DayView** (da codice esistente):
- Slot liberi: bordo tratteggiato + "+ Prenota" sempre visibile (non solo hover)
- Blocchi: click → dialog conferma "Rimuovere il blocco?" invece di rimozione immediata
- Card: ora in bold, servizio, prezzo, icona canale
- Riga ora corrente già evidenziata (da `9699830`), mantenere e rifinire

**Miglioramenti WeekView** (da codice esistente):
- Card appuntamento più ricche (come DayView)
- Blocchi con confirm dialog
- Oggi già evidenziato (da `a98a349`), mantenere

**Miglioramenti CalendarHeader** (da codice esistente):
- Tasto "Oggi" per tornare alla data corrente
- Toggle Day/Week (rimuovere Month)
- Date picker più accessibile

**File toccati**: `calendar/components/DayView.tsx`, `WeekView.tsx`, `CalendarHeader.tsx`, `AppointmentCard.tsx`
**File rimossi**: `calendar/components/MonthView.tsx`
**Modifiche correlate**: `calendar/page.tsx` — rimuovere import MonthView e stato view 'month'

## 5. Modal UX

**Problema**: 6 campi verticali con scroll, toggle cliente microscopico, slot in griglia fitta 4 colonne.

**Miglioramenti**:
- Riordino: Servizio → Operatore → Data/Orario → Cliente → (Canale, Note espandibili)
- Slot: griglia 3 colonne con pulsanti più grandi
- Date: 7 giorni con nome giorno + data in bold su due righe
- Cliente: Tab "Esistente / Nuovo" grandi invece del toggle
- Errori: inline vicino al campo, non in fondo
- Altezza modale: `max-h-[85vh]`

**File toccati**: `calendar/components/AppointmentModal.tsx`

## 6. Security

**Problema**: `/api/appointments` e `/api/services` in `isPublic`, admin client senza auth check in time-blocks/stats.

**Fix**:
- Proxy `isPublic`: rimuovere `/api/appointments` (dati clienti sensibili). `/api/services` RESTA pubblico (GET serve al widget di booking)
- `api/services/route.ts`: GET pubblico OK, POST aggiunge verifica auth nel handler (server client con `getUser()`)
- `api/appointments/route.ts`: già usa server client, ma ora protetto dal proxy. GET/POST/PATCH/DELETE richiedono auth
- `api/time-blocks/route.ts`: sostituire admin client con server client, verifiche RLS bastano
- `api/stats/route.ts`: sostituire admin client con server client
- `api/slots/route.ts`: admin client OK (widget pubblico, necessario per bypassare RLS), esporre solo orari

**File toccati**: `proxy.ts`, `api/services/route.ts`, `api/appointments/route.ts`, `api/time-blocks/route.ts`, `api/stats/route.ts`

## 7. Navigation & Layout

**Problema**: Pagine senza titolo consistente, nessun feedback di loading, stati vuoti assenti.

**Miglioramenti**:
- Breadcrumb + titolo pagina in ogni view
- Loading bar stile NProgress durante fetch
- Stati vuoti con illustrazione + CTA (es. "Nessun appuntamento oggi" + tasto crea)

**File toccati**: `(dashboard)/layout.tsx`, `lib/components/PageHeader.tsx` (nuovo)

## 8. Branding

**Requisiti**:
- Piattaforma: "LocalVista Gestionale Parrucchieri"
- Favicon: sostituire Vercel default con logo LocalVista
- Sidebar/Widget: nome salone dinamico da DB (es. HairForce per quel subaccount)
- Login: sempre "LocalVista Gestionale Parrucchieri"

**File toccati**: `app/layout.tsx` (metadata), `app/favicon.ico`, `login/page.tsx`

## Out of Scope (Phase 2+)

- Integrazione Treatwell attiva (polling, sync, write-back) — resta spenta
- GHL sync — resta com'è, non si tocca
- n8n webhook — restano com'è, non si tocca
- Vista multi-salone centralizzata
- Supabase Realtime
- App mobile / notifiche push

## Implementation Order

1. **Foundation**: `lib/date-utils.ts` + timezone fix in tutti i file
2. **Booking engine**: unifica `services/booking-engine/`, elimina `availability.ts`
3. **Security**: fix proxy + API routes auth
4. **State**: `useCalendarData` hook + error handling in calendar page
5. **UX Calendar**: DayView, WeekView, CalendarHeader, AppointmentCard
6. **UX Modal**: AppointmentModal redesign
7. **UX Navigation**: PageHeader, loading states, empty states
8. **Branding**: favicon, metadata, login page
