# Calendar Fix + n8n Sync Orchestrator

**Date:** 2026-05-19
**Status:** design-approved
**Branch:** TBD

## Context

HairForce is a hairdresser management system (Next.js 16 + Supabase + n8n + GHL). The booking engine core is solid, but the calendar UI and API layer have bugs that make the system unreliable. The goal is to fix all known bugs and move external sync (GHL, Treatwell) to be fully n8n-orchestrated, keeping Supabase as the single source of truth.

## Architecture Decision

**Supabase is the single writer for all appointments.** HairForce CRUD goes directly to Supabase. After every mutation (create, update, delete), a webhook is sent to n8n. n8n orchestrates all external sync: GHL contact/appointment CRUD, Treatwell slot blocking/unblocking. The existing `ghl-sync/` and `treatwell-sync/` services become utility modules — no longer called directly from API routes.

**Rationale:** If GHL or Treatwell is down, the salon continues working. n8n provides retry, queuing, and error handling. Adding future integrations doesn't require HairForce code changes.

## Data Flow

```
HairForce UI → Supabase PostgreSQL (CRUD, sync)
     │
     └→ POST /api/webhooks/n8n (event: create | update | delete)
              │
              ▼
         n8n workflow
              │
         ┌────┴────┐
         ▼         ▼
       GHL     Treatwell
       API       API
```

### Event types sent to n8n

| Event | Trigger | Payload |
|-------|---------|---------|
| `appointment.created` | POST /api/appointments | appointment, client, service, salon |
| `appointment.updated` | PATCH /api/appointments/[id] | appointment (partial), salon |
| `appointment.cancelled` | DELETE /api/appointments/[id] | id, salon_id, ghl_appointment_id, treatwell_appointment_id |
| `time_block.created` | POST /api/time-blocks | time_block |
| `time_block.deleted` | DELETE /api/time-blocks?id=X | id, salon_id |

## Bug Fixes

### Bug 1 — Cancel appointment sync
**File:** `src/app/api/appointments/[id]/route.ts`
**Fix:** After soft-delete (status=cancelled), send `appointment.cancelled` webhook to n8n with external IDs so n8n can cancel on GHL and release slot on Treatwell.

### Bug 2 — Delete from dashboard
**File:** `src/app/(dashboard)/calendar/page.tsx`
**Fix:** `handleDelete()` — add success/error toast. Await the fetch result before showing outcome. No functional change to the delete itself, just UX feedback.

### Bug 3 — Book in blocked slot
**Files:** `src/app/api/appointments/route.ts`
**Fix:** 
- POST: When `stylist_id` is null, check ALL time_blocks (not just null-stylist blocks). Currently only checks `stylist_id IS NULL` when no stylist is assigned.
- PATCH endpoint: add time_blocks conflict check (currently missing entirely — you can move an appointment into a blocked slot via edit).

### Bug 4 — Time block on existing appointment
**File:** `src/app/api/time-blocks/route.ts`
**Fix:** POST handler — before INSERT, query appointments table for overlapping active appointments (status != cancelled). Use same overlap logic as the booking engine. Return 409 on conflict.

### Bug 5 — Stylist hours in aggregated calendar
**Files:** `src/lib/hooks/useCalendarData.ts`, `src/app/(dashboard)/calendar/components/DayView.tsx`
**Fix:**
- `useCalendarData`: add `working_hours` to the stylist select query
- `DayView`: accept per-stylist hours, compute each stylist's hour range individually, render per-column hour ranges
- `WeekView`: mark days where stylist has day off (working_hours[day] === null)
- The booking engine already handles this correctly for API `/api/slots` — the fix is only in the UI layer

### Bug 6 — Global time block delete from DayView
**File:** `src/app/(dashboard)/calendar/components/DayView.tsx`
**Fix:** The block-match logic at line 88 `b.stylist_id === stylist.id` excludes global blocks (stylist_id=null). Extend the match to also include blocks where `b.stylist_id === null`. Show block reason in the confirm dialog.

## Validation Rules (API Layer)

These checks must run before any appointment write:

1. **Time blocks check** — no overlapping active time_block for the same stylist (or global block)
2. **Appointment conflict check** — no overlapping active appointment for the same stylist
3. **Past booking check** — start_time must be in the future (already checked in UI, add to API)
4. **Service exists** — already checked
5. **Salon hours** — slot must be within salon operating hours (new check, prevent out-of-hours bookings)

These checks must run before any time_block write:

1. **Appointment conflict check** — no overlapping active appointment for the same stylist (or any stylist for global blocks)

## Sync Log

The `sync_log` table tracks every sync attempt with columns: `salon_id`, `direction`, `appointment_id`, `status`, `external_id`, `error_message`, `retry_count`. This remains unchanged. n8n can write to sync_log via the same Supabase admin client for tracing.

## Out of Scope

- Real-time sync via WebSockets (polling is sufficient for current scale)
- Recurring appointments
- Multi-salon management
- Payment integration
- Email/SMS notifications (n8n handles this)
- Booking widget embedding (separate project)

## Migration Notes

- No database migration needed
- No new tables or columns
- The `ghl-sync/` and `treatwell-sync/` directories remain but are no longer imported by API routes
- n8n workflows need to be created/updated to handle the new webhook events
