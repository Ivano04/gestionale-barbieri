# Calendar Fix + n8n Sync Orchestrator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 calendar bugs and move external sync (GHL, Treatwell) to n8n-orchestrated webhooks, keeping Supabase as the single source of truth.

**Architecture:** A new `sync-webhook.ts` helper sends fire-and-forget events to n8n after every mutation. API routes (appointments CRUD, time_blocks CRUD) call this helper post-write. n8n workflows handle GHL/Treatwell API calls asynchronously. Direct calls to `ghl-sync/` and `treatwell-sync/` from API routes are removed — those modules stay as utility code.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL), TypeScript, date-fns, n8n webhooks

---

## File Structure

```
src/
├── lib/
│   └── sync-webhook.ts          ← NEW: fire-and-forget n8n event sender
├── app/
│   ├── api/
│   │   ├── appointments/
│   │   │   ├── route.ts          ← MODIFY: POST block fix, validation, n8n event
│   │   │   └── [id]/route.ts     ← MODIFY: PATCH block check, DELETE n8n event
│   │   └── time-blocks/
│   │       └── route.ts          ← MODIFY: POST conflict check, n8n events
│   └── (dashboard)/
│       └── calendar/
│           ├── page.tsx           ← MODIFY: handleDelete toast
│           └── components/
│               ├── DayView.tsx    ← MODIFY: per-stylist hours, global block fix
│               └── WeekView.tsx   ← MODIFY: stylist day-off indicator
└── lib/
    ├── hooks/
    │   └── useCalendarData.ts    ← MODIFY: stylist select + working_hours
    └── types/
        └── index.ts              ← MODIFY: add working_hours to User type (if needed)
```

---

### Task 1: Create n8n sync-webhook helper

**Files:**
- Create: `src/lib/sync-webhook.ts`

- [ ] **Step 1: Write the helper**

```typescript
// src/lib/sync-webhook.ts

export type N8nEvent =
  | 'appointment.created'
  | 'appointment.updated'
  | 'appointment.cancelled'
  | 'time_block.created'
  | 'time_block.deleted';

interface N8nPayload {
  event: N8nEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Fire-and-forget webhook to n8n. Never throws — failures are silent
 * because n8n unavailability must not block salon operations.
 */
export function sendN8nEvent(event: N8nEvent, data: Record<string, unknown>): void {
  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (!n8nUrl) return;

  const payload: N8nPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  fetch(n8nUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    // n8n unreachable — salon keeps working, n8n will catch up via polling or retry
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/sync-webhook.ts
git commit -m "feat: add fire-and-forget n8n webhook helper"
```

---

### Task 2: Fix Bug 4 — time_blocks POST checks appointments conflict + n8n event

**Files:**
- Modify: `src/app/api/time-blocks/route.ts:20-37` (POST handler)

- [ ] **Step 1: Add conflict check and n8n webhook to POST**

Replace the POST handler with this version that adds appointment overlap detection and n8n notification:

```typescript
// src/app/api/time-blocks/route.ts — POST handler (replaces lines 20-37)

import { sendN8nEvent } from '@/lib/sync-webhook';

export async function POST(request: Request) {
  const supabase = await createServerSupabase();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  // Check for conflicting appointments
  const conflictQuery = supabase
    .from('appointments')
    .select('id')
    .eq('salon_id', body.salon_id)
    .lt('start_time', body.end_time)
    .gt('end_time', body.start_time)
    .neq('status', 'cancelled');

  if (body.stylist_id) {
    conflictQuery.eq('stylist_id', body.stylist_id);
  }

  const { data: conflicts } = await conflictQuery.limit(1);
  if (conflicts?.length) {
    return Response.json(
      { error: 'Esistono appuntamenti in questa fascia oraria' },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from('time_blocks')
    .insert(body)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Fire-and-forget n8n webhook
  sendN8nEvent('time_block.created', {
    id: data.id,
    salon_id: data.salon_id,
    stylist_id: data.stylist_id,
    start_time: data.start_time,
    end_time: data.end_time,
    reason: data.reason,
  });

  return Response.json(data, { status: 201 });
}
```

- [ ] **Step 2: Update imports at top of file**

At the top of `src/app/api/time-blocks/route.ts`, add the import:

```typescript
import { sendN8nEvent } from '@/lib/sync-webhook';
```

- [ ] **Step 3: Verify the file compiles**

```bash
cd /Users/matthias/Desktop/Chat_Deepseek/gestionale-parrucchiere && npx tsc --noEmit src/app/api/time-blocks/route.ts 2>&1 | head -20
```

Expected: no type errors related to the new code.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/time-blocks/route.ts
git commit -m "fix: time_blocks POST checks appointment conflicts, sends n8n event"
```

---

### Task 3: Fix Bug 3 — appointments POST block check + PATCH block check + validation rules

**Files:**
- Modify: `src/app/api/appointments/route.ts` (POST handler, lines 47-59)
- Modify: `src/app/api/appointments/[id]/route.ts` (PATCH handler, lines 3-18)

- [ ] **Step 1: Fix POST block check logic**

In `src/app/api/appointments/route.ts`, replace the block check block (lines 47-59) with corrected logic. The current code only checks `stylist_id IS NULL` when no stylist is assigned — a global block with null stylist_id should block ALL bookings regardless:

```typescript
// src/app/api/appointments/route.ts — replace lines 47-59

// Check time blocks using admin client (bypass RLS)
const adminSupabase = createAdminClient();
let blockQuery = adminSupabase
  .from('time_blocks')
  .select('id')
  .eq('salon_id', body.salon_id)
  .lt('start_time', endTime)
  .gt('end_time', body.start_time);

// A global block (stylist_id=null) blocks everyone.
// A stylist-specific block blocks that stylist.
if (body.stylist_id) {
  blockQuery = blockQuery.or(`stylist_id.eq.${body.stylist_id},stylist_id.is.null`);
} else {
  // Booking without stylist: global blocks still apply
  blockQuery = blockQuery.is('stylist_id', null);
}
const { data: blocks } = await blockQuery.limit(1);
if (blocks?.length) {
  return Response.json({ error: 'Questo slot non è disponibile (fascia bloccata)' }, { status: 409 });
}
```

- [ ] **Step 2: Add past booking and salon hours validation to POST**

Insert these lines in `src/app/api/appointments/route.ts` after line 45 (`const endTime = ...`) and before line 47 (the time_blocks check):

```typescript
  // Past booking check
  if (new Date(body.start_time) < new Date()) {
    return Response.json({ error: 'Non puoi prenotare nel passato' }, { status: 400 });
  }

  // Salon hours check
  const dateStr = body.start_time.split('T')[0];
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayName = dayNames[new Date(dateStr + 'T12:00:00').getDay()];

  const { data: salonHours } = await supabase
    .from('salons')
    .select('working_hours, open_time, close_time')
    .eq('id', body.salon_id)
    .single();

  if (salonHours) {
    let wh = (salonHours.working_hours || {}) as Record<string, any>;
    if (typeof wh === 'string') try { wh = JSON.parse(wh); } catch {}

    if (wh?.[dayName] === null) {
      return Response.json({ error: 'Salone chiuso in questa data' }, { status: 400 });
    }

    const openTime = wh?.[dayName]?.open || salonHours.open_time || '09:00';
    const closeTime = wh?.[dayName]?.close || salonHours.close_time || '19:00';

    const slotTime = body.start_time.split('T')[1]?.substring(0, 5) || '';
    if (slotTime < openTime || slotTime >= closeTime) {
      return Response.json({ error: `Orario fuori dalla fascia ${openTime}-${closeTime}` }, { status: 400 });
    }

    const endSlotTime = endTime.split('T')[1]?.substring(0, 5) || '';
    if (endSlotTime > closeTime) {
      return Response.json({ error: `L'appuntamento sfora l'orario di chiusura (${closeTime})` }, { status: 400 });
    }
  }
```

- [ ] **Step 3: Add time_blocks and conflict checks to PATCH route**

In `src/app/api/appointments/[id]/route.ts`, replace the PATCH handler with one that includes conflict detection:

```typescript
// src/app/api/appointments/[id]/route.ts
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes } from 'date-fns';
import { sendN8nEvent } from '@/lib/sync-webhook';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const adminSupabase = createAdminClient();
  const body = await request.json();

  // If start_time or stylist_id changed, check for conflicts
  if (body.start_time || body.stylist_id) {
    // Fetch existing appointment to resolve fields
    const { data: existing } = await supabase
      .from('appointments')
      .select('stylist_id, service_id, salon_id, start_time')
      .eq('id', id)
      .single();

    if (!existing) {
      return Response.json({ error: 'Appuntamento non trovato' }, { status: 404 });
    }

    const newStylistId = body.stylist_id ?? existing.stylist_id;
    const newStartTime = body.start_time ?? existing.start_time;

    // Get service duration
    let durationMinutes: number | null = null;
    const serviceId = body.service_id ?? existing.service_id;
    if (serviceId) {
      const { data: service } = await supabase
        .from('services').select('duration_minutes').eq('id', serviceId).single();
      durationMinutes = service?.duration_minutes ?? null;
    }

    if (newStartTime && durationMinutes) {
      const endTime = addMinutes(new Date(newStartTime), durationMinutes).toISOString();

      // Past booking check
      if (new Date(newStartTime) < new Date()) {
        return Response.json({ error: 'Non puoi spostare un appuntamento nel passato' }, { status: 400 });
      }

      // Time blocks check
      let blockQuery = adminSupabase
        .from('time_blocks')
        .select('id')
        .eq('salon_id', existing.salon_id)
        .lt('start_time', endTime)
        .gt('end_time', newStartTime);

      if (newStylistId) {
        blockQuery = blockQuery.or(`stylist_id.eq.${newStylistId},stylist_id.is.null`);
      } else {
        blockQuery = blockQuery.is('stylist_id', null);
      }
      const { data: blocks } = await blockQuery.limit(1);
      if (blocks?.length) {
        return Response.json({ error: 'Questo slot non è disponibile (fascia bloccata)' }, { status: 409 });
      }

      // Appointment conflict check (exclude self)
      let conflictQuery = supabase
        .from('appointments').select('id')
        .eq('stylist_id', newStylistId)
        .eq('salon_id', existing.salon_id)
        .lt('start_time', endTime)
        .gt('end_time', newStartTime)
        .neq('status', 'cancelled')
        .neq('id', id);

      const { data: conflict } = await conflictQuery.limit(1);
      if (conflict?.length) {
        return Response.json({ error: 'Slot già occupato' }, { status: 409 });
      }
    }
  }

  // Cleanup: convert empty strings to null
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    clean[k] = v === '' ? null : v;
  }

  const { data, error } = await supabase
    .from('appointments')
    .update(clean)
    .eq('id', id)
    .select('*, client:clients(*), stylist:users(*), service:services(*)')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Fire-and-forget n8n webhook
  sendN8nEvent('appointment.updated', {
    id: data.id,
    salon_id: data.salon_id,
    ghl_appointment_id: data.ghl_appointment_id,
    treatwell_appointment_id: data.treatwell_appointment_id,
    changes: clean,
  });

  return Response.json(data);
}
```

- [ ] **Step 4: Verify compilation**

```bash
cd /Users/matthias/Desktop/Chat_Deepseek/gestionale-parrucchiere && npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

Expected: no new type errors. (There may be pre-existing ones unrelated to our changes.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/appointments/route.ts src/app/api/appointments/\[id\]/route.ts
git commit -m "fix: block check in POST, add conflict checks to PATCH, validate past/salon-hours"
```

---

### Task 4: Fix Bug 1 — DELETE appointment sends n8n webhook

**Files:**
- Modify: `src/app/api/appointments/[id]/route.ts:20-26` (DELETE handler)

- [ ] **Step 1: Extend DELETE to send n8n webhook**

Replace the DELETE handler in `src/app/api/appointments/[id]/route.ts`:

```typescript
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // Fetch external IDs before cancelling
  const { data: existing } = await supabase
    .from('appointments')
    .select('ghl_appointment_id, treatwell_appointment_id, salon_id')
    .eq('id', id)
    .single();

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Fire-and-forget n8n event so it can cancel on GHL + release Treatwell slot
  sendN8nEvent('appointment.cancelled', {
    id,
    salon_id: existing?.salon_id,
    ghl_appointment_id: existing?.ghl_appointment_id,
    treatwell_appointment_id: existing?.treatwell_appointment_id,
  });

  return Response.json({ status: 'ok' });
}
```

The imports at top of file already include `sendN8nEvent` from Task 3 Step 3.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/appointments/\[id\]/route.ts
git commit -m "fix: DELETE appointment sends n8n webhook for external sync"
```

---

### Task 5: Fix Bug 2 — Delete toast feedback in UI

**Files:**
- Modify: `src/app/(dashboard)/calendar/page.tsx:79-87` (handleDelete)

- [ ] **Step 1: Add toast feedback to handleDelete**

Replace the `handleDelete` function in `src/app/(dashboard)/calendar/page.tsx`:

```typescript
async function handleDelete(id: string) {
  setSelectedAppointment(null);
  try {
    const res = await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Appuntamento cancellato');
    } else {
      const err = await res.json();
      toast.error(err.error || 'Errore cancellazione');
    }
  } catch {
    toast.error('Errore di connessione');
  }
  refresh();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/calendar/page.tsx
git commit -m "fix: add toast feedback on appointment delete"
```

---

### Task 6: Fix Bug 5 — Stylist working_hours in calendar

**Files:**
- Modify: `src/lib/hooks/useCalendarData.ts:52` (stylist query)
- Modify: `src/app/(dashboard)/calendar/components/DayView.tsx` (props + hour rendering)
- Modify: `src/app/(dashboard)/calendar/components/WeekView.tsx` (day-off indicator)

- [ ] **Step 1: Add working_hours to stylist query**

In `src/lib/hooks/useCalendarData.ts`, change line 52 from:
```typescript
supabase.from('users').select('id, full_name').eq('salon_id', salonId).eq('role', 'stylist'),
```
to:
```typescript
supabase.from('users').select('id, full_name, working_hours').eq('salon_id', salonId).eq('role', 'stylist'),
```

And update the `stylists` type in the hook's return interface. In `useCalendarData.ts`, change the `stylists` type declaration from:
```typescript
stylists: Pick<User, 'id' | 'full_name'>[];
```
to:
```typescript
stylists: Pick<User, 'id' | 'full_name' | 'working_hours'>[];
```

- [ ] **Step 2: Update DayView to accept and render per-stylist hours**

In `src/app/(dashboard)/calendar/components/DayView.tsx`, update the `Props` interface and the component:

First, change the `stylists` prop type in the interface (line 7):
```typescript
interface Props {
  date: Date;
  stylists: Pick<User, 'id' | 'full_name' | 'working_hours'>[];
  appointments: Appointment[];
  timeBlocks: TimeBlock[];
  salonHours: { open: string; close: string };
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onDeleteBlock: (blockId: string) => void;
}
```

Then add a helper function at the top of the component to resolve per-stylist hours:

```typescript
// Add after the STYLIST_COLORS constant (line 17), before the DayView function
function getStylistHours(
  stylist: Pick<User, 'id' | 'full_name' | 'working_hours'>,
  salonHours: { open: string; close: string },
  date: Date
): { open: string; close: string } | null {
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayName = dayNames[date.getDay()];

  let swh = (stylist.working_hours || {}) as Record<string, any>;
  if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
  const stylistDay = swh?.[dayName];

  // null means day off (same convention as salon working_hours)
  if (Object.keys(swh).length > 0 && stylistDay === null) return null;

  return {
    open: stylistDay?.open || salonHours.open,
    close: stylistDay?.close || salonHours.close,
  };
}
```

Then in the column per stylist (line 61-118), use per-stylist hours. Replace lines 62-64:

```typescript
// In the stylists.map callback (line 60), replace lines 62-64:
const stHours = getStylistHours(stylist, salonHours, date);
const openH = stHours ? parseInt(stHours.open.split(':')[0]) : 0;
const closeH = stHours ? parseInt(stHours.close.split(':')[0]) : 0;
const hours = stHours ? Array.from({ length: closeH - openH }, (_, i) => i + openH) : [];
```

If `stHours` is null (day off), render a "giorno libero" cell instead of the hour grid.

- [ ] **Step 3: Update WeekView to show day-off**

In `src/app/(dashboard)/calendar/components/WeekView.tsx`, update the `stylists` prop type and mark days where a stylist has a day off.

Change the Props interface (lines 7-15):
```typescript
interface Props {
  date: Date;
  stylists: Pick<User, 'id' | 'full_name' | 'working_hours'>[];
  appointments: Appointment[];
  timeBlocks: TimeBlock[];
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onDeleteBlock: (blockId: string) => void;
}
```

Add a helper inside the component to check if a stylist is off on a given day. In the day cell (line 63-103), check if the stylist has a day off for that day and if so, render a dimmed cell with "Riposo" instead of the normal clickable cell.

```typescript
// Add inside WeekView component, before the return:
function isDayOff(stylist: typeof stylists[0], d: Date): boolean {
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayName = dayNames[d.getDay()];
  let swh = (stylist.working_hours || {}) as Record<string, any>;
  if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
  return Object.keys(swh).length > 0 && swh?.[dayName] === null;
}
```

Then in the day cell rendering (line 64), after computing `dayBlocked`:

```typescript
// Add after line 62:
const dayOff = isDayOff(stylist, d);
```

And modify the className and onClick to handle the day-off state:

```typescript
// Replace lines 65-79 with:
className={`border-l p-1.5 min-h-[80px] ${
  dayOff ? 'bg-gray-100/70 cursor-default' :
  dayBlocked ? 'bg-red-50/30 cursor-pointer' :
  isSameDay(d, today) ? 'bg-blue-50/10 cursor-pointer' :
  'hover:bg-gray-50/50 cursor-pointer'
}`}
onClick={() => {
  if (dayOff) return;
  if (dayBlocked) {
    const block = timeBlocks.find(b => {
      if (b.stylist_id && b.stylist_id !== stylist.id) return false;
      return isSameDay(parseISO(b.start_time), d) || isSameDay(parseISO(b.end_time), d);
    });
    if (block && confirm(`Rimuovere il blocco${block.reason ? ` "${block.reason}"` : ''}?`)) {
      onDeleteBlock(block.id);
    }
  } else {
    onSlotClick(stylist.id, buildSlotTime(format(d, 'yyyy-MM-dd'), '08:00'));
  }
}}>
```

And add a "Riposo" label inside the day cell when dayOff is true:

```typescript
{/* Add at the beginning of the day cell children (before dayApps.map): */}
{dayOff && (
  <div className="text-[10px] text-gray-400 text-center py-4">Riposo</div>
)}
```

- [ ] **Step 4: Update the calendar page to accept the new stylist type**

In `src/app/(dashboard)/calendar/page.tsx`, no changes needed — the `stylists` from `useCalendarData` now includes `working_hours` and passes through to DayView/WeekView transparently.

- [ ] **Step 5: Verify compilation**

```bash
cd /Users/matthias/Desktop/Chat_Deepseek/gestionale-parrucchiere && npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

Expected: no type errors related to stylist hours.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hooks/useCalendarData.ts src/app/\(dashboard\)/calendar/components/DayView.tsx src/app/\(dashboard\)/calendar/components/WeekView.tsx
git commit -m "feat: per-stylist working hours in DayView and WeekView"
```

---

### Task 7: Fix Bug 6 — Global time block delete from DayView

**Files:**
- Modify: `src/app/(dashboard)/calendar/components/DayView.tsx:86-95`

- [ ] **Step 1: Fix the block-match logic to include global blocks**

In `DayView.tsx`, the click handler for blocked cells (lines 85-95) currently does:
```typescript
const block = timeBlocks.find(b => {
  const bStart = parseISO(b.start_time); const bEnd = parseISO(b.end_time);
  return b.stylist_id === stylist.id && slotStart < bEnd && slotEnd > bStart;
});
```

Replace with logic that also matches global blocks (stylist_id=null):
```typescript
const block = timeBlocks.find(b => {
  const bStart = parseISO(b.start_time);
  const bEnd = parseISO(b.end_time);
  if (!(slotStart < bEnd && slotEnd > bStart)) return false;
  // Match stylist-specific block OR global block (null)
  return b.stylist_id === stylist.id || b.stylist_id === null;
});
```

And update the confirm dialog (line 92) to show the block reason and whether it's a global or stylist-specific block:
```typescript
if (block && confirm(
  `Rimuovere il blocco${block.reason ? ` "${block.reason}"` : ''}${block.stylist_id ? '' : ' (tutto il salone)'}?`
)) onDeleteBlock(block.id);
```

Also update the blocked cell display text (lines 98-102) — the current code has a redundant find. Replace with:
```typescript
{isBlocked && (
  <div className="absolute inset-0 flex items-center justify-center z-10">
    <div className="w-full border-t-2 border-red-300 rotate-12" />
    <span className="absolute text-[10px] text-red-400 font-medium bg-white/80 px-1 rounded">
      {blockLabel}
    </span>
  </div>
)}
```

Where `blockLabel` is computed alongside `isBlocked`:
```typescript
// Replace lines 70-75 (isBlocked computation) with:
const matchingBlock = timeBlocks.find(b => {
  const bStart = parseISO(b.start_time);
  const bEnd = parseISO(b.end_time);
  if (!(slotStart < bEnd && slotEnd > bStart)) return false;
  const bStylist = b.stylist_id;
  return bStylist === stylist.id || bStylist === null;
});
const isBlocked = !!matchingBlock;
const blockLabel = matchingBlock?.reason || 'Non disp.';
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/matthias/Desktop/Chat_Deepseek/gestionale-parrucchiere && npx tsc --noEmit 2>&1 | grep -E "DayView.*error" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/calendar/components/DayView.tsx
git commit -m "fix: global time blocks deletable from any stylist column in DayView"
```

---

### Task 8: Wire appointments POST n8n webhook + time_blocks DELETE n8n webhook

**Files:**
- Modify: `src/app/api/appointments/route.ts` (POST handler, after INSERT)
- Modify: `src/app/api/time-blocks/route.ts` (DELETE handler)

- [ ] **Step 1: Add n8n webhook to appointments POST**

In `src/app/api/appointments/route.ts`, after the successful INSERT (line 105 `return Response.json(appointment, { status: 201 })`), add a fire-and-forget webhook before the return:

Replace lines 104-105:
```typescript
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(appointment, { status: 201 });
```

with:
```typescript
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Fire-and-forget n8n webhook for external sync
  sendN8nEvent('appointment.created', {
    id: appointment.id,
    salon_id: appointment.salon_id,
    stylist_id: appointment.stylist_id,
    client_id: appointment.client_id,
    service_id: appointment.service_id,
    start_time: appointment.start_time,
    end_time: appointment.end_time,
    source: appointment.source,
    ghl_appointment_id: appointment.ghl_appointment_id,
    treatwell_appointment_id: appointment.treatwell_appointment_id,
  });

  return Response.json(appointment, { status: 201 });
```

Add the import at the top of the file if not already present:
```typescript
import { sendN8nEvent } from '@/lib/sync-webhook';
```

- [ ] **Step 2: Add n8n webhook to time_blocks DELETE**

In `src/app/api/time-blocks/route.ts`, replace the DELETE handler (lines 39-55):

```typescript
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const supabase = await createServerSupabase();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch salon_id before deleting (for n8n event)
  const { data: existing } = await supabase
    .from('time_blocks')
    .select('salon_id')
    .eq('id', id)
    .single();

  const { error } = await supabase.from('time_blocks').delete().eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Fire-and-forget n8n webhook
  sendN8nEvent('time_block.deleted', {
    id,
    salon_id: existing?.salon_id,
  });

  return Response.json({ status: 'ok' });
}
```

The `sendN8nEvent` import is already at the top of the file from Task 2.

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/matthias/Desktop/Chat_Deepseek/gestionale-parrucchiere && npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/appointments/route.ts src/app/api/time-blocks/route.ts
git commit -m "feat: appointments POST and time_blocks DELETE send n8n webhooks"
```

---

### Task 9: Remove direct sync calls from API routes

**Files:**
- Modify: `src/app/api/appointments/route.ts` (remove any import/call to ghl-sync or treatwell-sync)

- [ ] **Step 1: Remove direct sync imports**

Check `src/app/api/appointments/route.ts` for any import from `ghl-sync` or `treatwell-sync`. From reading the current file, there are no such imports — the sync was never wired in the POST route. Verify:

```bash
cd /Users/matthias/Desktop/Chat_Deepseek/gestionale-parrucchiere && grep -rn "ghl-sync\|treatwell-sync\|pushToGHL\|checkAndWriteTreatwell" src/app/api/ --include="*.ts"
```

Expected: no results in the API routes. If there are results, remove those imports and calls (they're now handled by n8n).

- [ ] **Step 2: Document the sync services are now utility-only**

No code changes needed — the `ghl-sync/` and `treatwell-sync/` modules remain on disk as reference/utility but are no longer imported by any API route.

- [ ] **Step 3: Commit** (only if changes were made)

```bash
# Only if grep found something to clean up
git add -A && git commit -m "chore: remove direct sync calls from API routes (now handled by n8n)"
```

---

## Verification Checklist

After all tasks are complete, run these checks:

1. **Compilation**: `npx tsc --noEmit` — no type errors
2. **API tests via curl**:
   ```bash
   # Create appointment — should return 201
   # Delete appointment — should return 200 and log "appointment.cancelled" event
   # Create time_block on existing appointment — should return 409
   # Create appointment inside time_block — should return 409
   # Create appointment in the past — should return 400
   ```
3. **UI smoke test**: `npm run dev` — calendar loads, DayView shows per-stylist hours, blocks deletable, delete shows toast
4. **n8n verification**: Check n8n receives webhook events with correct `event` field

---

## n8n Workflow Configuration (Manual)

After code changes, these n8n workflows must be created/updated:

1. **HairForce → GHL sync**: Listens for `appointment.created/updated/cancelled` events, calls GHL API accordingly
2. **HairForce → Treatwell sync**: Listens for `appointment.created/cancelled` and `time_block.created/deleted`, calls Treatwell API
3. **Treatwell → HairForce poll**: Existing — no change needed
4. **GHL → HairForce**: Existing (via n8n webhook to HairForce) — no change needed
