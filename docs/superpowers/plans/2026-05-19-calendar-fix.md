# Phase 1 — Stabilize Core & UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix timezone bugs, unify booking engine, secure APIs, and improve calendar/modal/navigation UX in the LocalVista salon management app.

**Architecture:** Next.js 16 App Router with Supabase. Monolith with API routes, service modules (`src/services/`), and client components. Build on existing direction — not from scratch.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Supabase, Tailwind 4, date-fns 4, lucide-react, sonner

---

### Task 1: Date Utils — Centralized Timezone Helpers

**Files:**
- Create: `src/lib/date-utils.ts`

- [ ] **Step 1: Create `src/lib/date-utils.ts`**

```typescript
import { parseISO } from 'date-fns';

/** Format an ISO string as HH:mm in the local (browser) timezone */
export function toLocalTimeString(iso: string): string {
  const d = parseISO(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** Build a full ISO string from a date string and a HH:mm time, using the local timezone offset */
export function buildSlotTime(dateStr: string, time: string): string {
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = String(Math.abs(offset)).padStart(2, '0');
  return `${dateStr}T${time}:00${sign}${abs}:00`;
}

/** Check whether a slot identified by date + time is in the past */
export function isPastSlot(dateStr: string, time: string): boolean {
  const slot = new Date(`${dateStr}T${time}:00`);
  return slot < new Date();
}

/** Get today's date string in yyyy-MM-dd format (local timezone) */
export function todayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/date-utils.ts
git commit -m "feat: add centralized date-utils with timezone-safe helpers"
```

---

### Task 2: Timezone Fix — Slots API

**Files:**
- Modify: `src/app/api/slots/route.ts` (all `+02:00` → dynamic offset)
- Modify: `src/services/booking-engine/availability.ts` (same fix for the old module, until we refactor it in Task 3)

- [ ] **Step 1: Fix `src/app/api/slots/route.ts`**

Replace all hardcoded `+02:00` strings. The key change: derive the timezone offset dynamically.

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes, parseISO } from 'date-fns';

/** Return the current local timezone offset as a string like "+02:00" or "+01:00" */
function getLocalOffset(): string {
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = String(Math.abs(offset)).padStart(2, '0');
  return `${sign}${abs}:00`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const service_id = searchParams.get('service_id');
  const stylist_id = searchParams.get('stylist_id');
  const date = searchParams.get('date');

  if (!salon_id || !service_id || !date) {
    return Response.json({ error: 'salon_id, service_id, date required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = dayNames[new Date(date + 'T12:00:00').getDay()];
  const tzOffset = getLocalOffset();

  // Get salon hours for today
  const { data: salon } = await supabase.from('salons').select('working_hours, open_time, close_time').eq('id', salon_id).single();
  let wh = (salon?.working_hours || {}) as Record<string, any>;
  if (typeof wh === 'string') try { wh = JSON.parse(wh); } catch {}
  const salonDay = wh?.[today];
  if (Object.keys(wh).length > 0 && salonDay === null) return Response.json([]);
  const salonOpen = salonDay?.open || salon?.open_time || '09:00';
  const salonClose = salonDay?.close || salon?.close_time || '19:00';

  const { data: service } = await supabase.from('services').select('duration_minutes').eq('id', service_id).single();
  if (!service) return Response.json({ error: 'service not found' }, { status: 404 });
  const duration = service.duration_minutes;

  let stylistQuery = supabase.from('users').select('id, full_name, working_hours').eq('salon_id', salon_id).eq('role', 'stylist');
  if (stylist_id) stylistQuery = stylistQuery.eq('id', stylist_id);
  const { data: stylists } = await stylistQuery;
  if (!stylists?.length) return Response.json([]);

  const dayStart = new Date(`${date}T${salonOpen}:00${tzOffset}`);
  const dayEnd = new Date(`${date}T${salonClose}:00${tzOffset}`);

  const { data: appointments } = await supabase
    .from('appointments').select('stylist_id, start_time, end_time')
    .eq('salon_id', salon_id).gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString()).neq('status', 'cancelled');

  const { data: blocks } = await supabase
    .from('time_blocks').select('stylist_id, start_time, end_time')
    .eq('salon_id', salon_id).gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString());

  const occupied = [...(appointments || []), ...(blocks || [])];
  const slots: { time: string; stylist_id: string; stylist_name: string }[] = [];

  for (const stylist of stylists) {
    let swh = (stylist.working_hours || {}) as any;
    if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
    const stylistDay = swh?.[today];
    if (Object.keys(swh).length > 0 && stylistDay === null) continue;
    const sOpen = stylistDay?.open || salonOpen;
    const sClose = stylistDay?.close || salonClose;
    const sStart = new Date(`${date}T${sOpen}:00${tzOffset}`);
    const sEnd = new Date(`${date}T${sClose}:00${tzOffset}`);

    let current = sStart;
    while (current < sEnd) {
      const slotEnd = addMinutes(current, duration);
      if (slotEnd > sEnd) break;
      const isFree = !occupied.some(o => {
        if (o.stylist_id && o.stylist_id !== stylist.id) return false;
        const oStart = parseISO(o.start_time);
        const oEnd = parseISO(o.end_time);
        return current < oEnd && slotEnd > oStart;
      });
      if (isFree) {
        const time = current.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
        slots.push({ time, stylist_id: stylist.id, stylist_name: stylist.full_name });
      }
      current = addMinutes(current, 30);
    }
  }

  return Response.json(slots);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/slots/route.ts
git commit -m "fix: dynamic timezone offset in slots API, remove hardcoded +02:00"
```

---

### Task 3: Timezone Fix — Calendar Page & AppointmentModal

**Files:**
- Modify: `src/app/(dashboard)/calendar/page.tsx:25-26` (blockForm default)
- Modify: `src/app/(dashboard)/calendar/page.tsx:243-244` (time block creation)
- Modify: `src/app/(dashboard)/calendar/components/AppointmentModal.tsx:153-156` (slot selection)

- [ ] **Step 1: Fix calendar page hardcoded offsets**

In `src/app/(dashboard)/calendar/page.tsx`, find the `blockForm` state init on line 25 and replace the hardcoded date string with `todayDateStr()`:

```typescript
import { todayDateStr } from '@/lib/date-utils';

// Replace line 25-26:
// const [blockForm, setBlockForm] = useState({ stylist_id: '', date: format(new Date(), 'yyyy-MM-dd'), start: '12:00', end: '13:00', reason: '' });
const [blockForm, setBlockForm] = useState({ stylist_id: '', date: todayDateStr(), start: '12:00', end: '13:00', reason: '' });
```

Replace the time block creation on line 243-244 where `+02:00` is hardcoded:

```typescript
// Replace lines 243-244:
// const startTime = `${blockForm.date}T${blockForm.start}:00+02:00`;
// const endTime = `${blockForm.date}T${blockForm.end}:00+02:00`;
const offset = -new Date().getTimezoneOffset();
const sign = offset >= 0 ? '+' : '-';
const absH = String(Math.abs(Math.floor(offset / 60))).padStart(2, '0');
const absM = String(Math.abs(offset % 60)).padStart(2, '0');
const tz = `${sign}${absH}:${absM}`;
const startTime = `${blockForm.date}T${blockForm.start}:00${tz}`;
const endTime = `${blockForm.date}T${blockForm.end}:00${tz}`;
```

- [ ] **Step 2: Fix AppointmentModal slot selection**

In `src/app/(dashboard)/calendar/components/AppointmentModal.tsx`, find the slot button onClick (lines 155-156) and replace `+02:00`:

```typescript
// Replace line 156:
// onClick={() => setForm(f => ({ ...f, start_time: `${slotDate}T${s.time}:00+02:00` }))}
// With:
onClick={() => {
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absH = String(Math.abs(Math.floor(offset / 60))).padStart(2, '0');
  const absM = String(Math.abs(offset % 60)).padStart(2, '0');
  const tz = `${sign}${absH}:${absM}`;
  setForm(f => ({ ...f, start_time: `${slotDate}T${s.time}:00${tz}` }));
}}
```

Also update the `isSelected` check on line 153 to use the dynamic offset:

```typescript
// Replace line 153:
// const isSelected = form.start_time === `${slotDate}T${s.time}:00+02:00`;
// With a more robust check:
const isSelected = form.start_time
  ? form.start_time.startsWith(`${slotDate}T${s.time}:00`)
  : false;
```

And the slot `useEffect` dependency: slotDate already in deps — no change needed.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/calendar/page.tsx src/app/\(dashboard\)/calendar/components/AppointmentModal.tsx
git commit -m "fix: dynamic timezone offset in calendar page and appointment modal"
```

---

### Task 4: Unified Booking Engine

**Files:**
- Create: `src/services/booking-engine/index.ts` (replaces `availability.ts`)
- Create: `src/services/booking-engine/queries.ts`
- Create: `src/services/booking-engine/overlap.ts`
- Delete: `src/services/booking-engine/availability.ts`
- Modify: `src/app/api/slots/route.ts` (use new engine)

- [ ] **Step 1: Create `src/services/booking-engine/overlap.ts`**

Pure functions, no dependencies.

```typescript
import { addMinutes } from 'date-fns';

export interface OccupiedBlock {
  stylist_id: string | null;
  start_time: Date;
  end_time: Date;
}

export function isOverlap(a: Date, aEnd: Date, b: Date, bEnd: Date): boolean {
  return a < bEnd && aEnd > b;
}

export function isSlotFree(
  stylistId: string,
  slotStart: Date,
  slotEnd: Date,
  occupied: OccupiedBlock[]
): boolean {
  return !occupied.some(o => {
    if (o.stylist_id && o.stylist_id !== stylistId) return false;
    return isOverlap(slotStart, slotEnd, o.start_time, o.end_time);
  });
}

export interface GenerateSlotsParams {
  sStart: Date;
  sEnd: Date;
  duration: number;
  step: number;
  occupied: OccupiedBlock[];
  stylistId: string;
  stylistName: string;
}

export interface Slot {
  time: string;
  stylist_id: string;
  stylist_name: string;
}

export function generateSlots(params: GenerateSlotsParams): Slot[] {
  const { sStart, sEnd, duration, step, occupied, stylistId, stylistName } = params;
  const slots: Slot[] = [];
  let current = sStart;
  while (current < sEnd) {
    const slotEnd = addMinutes(current, duration);
    if (slotEnd > sEnd) break;
    if (isSlotFree(stylistId, current, slotEnd, occupied)) {
      const time = current.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
      slots.push({ time, stylist_id: stylistId, stylist_name: stylistName });
    }
    current = addMinutes(current, step);
  }
  return slots;
}
```

- [ ] **Step 2: Create `src/services/booking-engine/queries.ts`**

Supabase data fetching — uses admin client (required for public widget access and bypassing RLS for slot calculation).

```typescript
import { createAdminClient } from '@/lib/supabase/admin';

export interface SlotRequest {
  salon_id: string;
  service_id: string;
  stylist_id?: string;
  date: string;
}

export async function fetchSalonHours(salonId: string, dayName: string) {
  const supabase = createAdminClient();
  const { data: salon } = await supabase
    .from('salons')
    .select('working_hours, open_time, close_time')
    .eq('id', salonId)
    .single();

  let wh = (salon?.working_hours || {}) as Record<string, any>;
  if (typeof wh === 'string') try { wh = JSON.parse(wh); } catch {}

  const salonDay = wh?.[dayName];
  // null means explicitly closed
  if (Object.keys(wh).length > 0 && salonDay === null) return null;

  return {
    open: salonDay?.open || salon?.open_time || '09:00',
    close: salonDay?.close || salon?.close_time || '19:00',
  };
}

export async function fetchServiceDuration(serviceId: string) {
  const supabase = createAdminClient();
  const { data: service } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .single();
  return service?.duration_minutes || null;
}

export async function fetchStylists(salonId: string, stylistId?: string) {
  const supabase = createAdminClient();
  let query = supabase
    .from('users')
    .select('id, full_name, working_hours')
    .eq('salon_id', salonId)
    .eq('role', 'stylist');
  if (stylistId) query = query.eq('id', stylistId);
  const { data: stylists } = await query;
  return stylists || [];
}

export async function fetchOccupiedSlots(
  salonId: string,
  dayStart: Date,
  dayEnd: Date
) {
  const supabase = createAdminClient();
  const [appsRes, blocksRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('stylist_id, start_time, end_time')
      .eq('salon_id', salonId)
      .gte('start_time', dayStart.toISOString())
      .lte('start_time', dayEnd.toISOString())
      .neq('status', 'cancelled'),
    supabase
      .from('time_blocks')
      .select('stylist_id, start_time, end_time')
      .eq('salon_id', salonId)
      .gte('start_time', dayStart.toISOString())
      .lte('start_time', dayEnd.toISOString()),
  ]);
  return [...(appsRes.data || []), ...(blocksRes.data || [])];
}
```

- [ ] **Step 3: Create `src/services/booking-engine/index.ts`**

Unified public API — the only function external callers use.

```typescript
import { fetchSalonHours, fetchServiceDuration, fetchStylists, fetchOccupiedSlots } from './queries';
import { generateSlots, type Slot } from './overlap';

function getLocalOffset(): string {
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = String(Math.abs(offset)).padStart(2, '0');
  return `${sign}${abs}:00`;
}

export interface GetAvailableSlotsParams {
  salon_id: string;
  service_id: string;
  stylist_id?: string;
  date: string;
}

export async function getAvailableSlots(params: GetAvailableSlotsParams): Promise<Slot[]> {
  const { salon_id, service_id, stylist_id, date } = params;
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = dayNames[new Date(date + 'T12:00:00').getDay()];
  const tzOffset = getLocalOffset();

  const hours = await fetchSalonHours(salon_id, today);
  if (!hours) return []; // Salon closed today

  const duration = await fetchServiceDuration(service_id);
  if (!duration) return [];

  const stylists = await fetchStylists(salon_id, stylist_id);
  if (!stylists.length) return [];

  const dayStart = new Date(`${date}T${hours.open}:00${tzOffset}`);
  const dayEnd = new Date(`${date}T${hours.close}:00${tzOffset}`);

  const occupied = await fetchOccupiedSlots(salon_id, dayStart, dayEnd);

  const allSlots: Slot[] = [];

  for (const stylist of stylists) {
    let swh = (stylist.working_hours || {}) as any;
    if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
    const stylistDay = swh?.[today];
    if (Object.keys(swh).length > 0 && stylistDay === null) continue;

    const sOpen = stylistDay?.open || hours.open;
    const sClose = stylistDay?.close || hours.close;
    const sStart = new Date(`${date}T${sOpen}:00${tzOffset}`);
    const sEnd = new Date(`${date}T${sClose}:00${tzOffset}`);

    const slots = generateSlots({
      sStart, sEnd, duration, step: 30, occupied,
      stylistId: stylist.id, stylistName: stylist.full_name,
    });
    allSlots.push(...slots);
  }

  return allSlots;
}

// Re-export Slot type for consumers
export type { Slot };
```

- [ ] **Step 4: Simplify `src/app/api/slots/route.ts` to use the engine**

```typescript
import { getAvailableSlots } from '@/services/booking-engine';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const service_id = searchParams.get('service_id');
  const stylist_id = searchParams.get('stylist_id');
  const date = searchParams.get('date');

  if (!salon_id || !service_id || !date) {
    return Response.json({ error: 'salon_id, service_id, date required' }, { status: 400 });
  }

  const slots = await getAvailableSlots({
    salon_id,
    service_id,
    stylist_id: stylist_id || undefined,
    date,
  });

  return Response.json(slots);
}
```

- [ ] **Step 5: Delete old `availability.ts`**

```bash
rm src/services/booking-engine/availability.ts
```

- [ ] **Step 6: Verify `src/services/booking-engine/` directory structure**

```bash
ls src/services/booking-engine/
# Expected: index.ts  overlap.ts  queries.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/services/booking-engine/ src/app/api/slots/route.ts
git commit -m "refactor: unified booking engine, remove duplicate availability.ts"
```

---

### Task 5: Security — Proxy & API Routes

**Files:**
- Modify: `src/proxy.ts:12` (remove `/api/appointments` from isPublic)
- Modify: `src/app/api/services/route.ts` (add auth check to POST)
- Modify: `src/app/api/time-blocks/route.ts` (admin client → server client)

- [ ] **Step 1: Fix `src/proxy.ts` — remove `/api/appointments` from isPublic**

```typescript
// Replace lines 7-15:
const isPublic = request.nextUrl.pathname.startsWith('/book/') ||
                 request.nextUrl.pathname.startsWith('/login') ||
                 request.nextUrl.pathname.startsWith('/auth') ||
                 request.nextUrl.pathname.startsWith('/api/book/') ||
                 request.nextUrl.pathname.startsWith('/api/slots') ||
                 request.nextUrl.pathname.startsWith('/api/services') ||
                 request.nextUrl.pathname.startsWith('/_next') ||
                 request.nextUrl.pathname === '/favicon.ico';
```

Key changes:
- Removed `/api/appointments` (sensitive client data)
- Kept `/api/services` (GET needed by booking widget)
- Kept `/api/slots`, `/api/book/` (public widget)

- [ ] **Step 2: Add auth check to `src/app/api/services/route.ts` POST**

```typescript
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salonId = searchParams.get('salon_id');
  if (!salonId) return Response.json({ error: 'salon_id required' }, { status: 400 });

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('salon_id', salonId)
    .eq('is_active', true)
    .order('name');

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();

  // Auth check — only authenticated users can create services
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { data, error } = await supabase
    .from('services')
    .insert(body)
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
```

- [ ] **Step 3: Replace admin client with server client in `src/app/api/time-blocks/route.ts`**

```typescript
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  if (!salon_id) return Response.json({ error: 'salon_id required' }, { status: 400 });

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('time_blocks')
    .select('*')
    .eq('salon_id', salon_id)
    .gte('end_time', new Date().toISOString())
    .order('start_time');

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data || []);
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { data, error } = await supabase
    .from('time_blocks')
    .insert(body)
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase.from('time_blocks').delete().eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ status: 'ok' });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/proxy.ts src/app/api/services/route.ts src/app/api/time-blocks/route.ts
git commit -m "fix: secure API routes - remove appointments from isPublic, add auth to POST services, server client in time-blocks"
```

---

### Task 6: Stats API — Replace Admin Client

**Files:**
- Modify: `src/app/api/stats/route.ts`

- [ ] **Step 1: Replace admin client with server client in stats route**

```typescript
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  if (!salon_id) return Response.json({ error: 'salon_id required' }, { status: 400 });

  const supabase = await createServerSupabase();
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, client_id, service_id, start_time, status, source, service:services(price_cents, name)')
    .eq('salon_id', salon_id)
    .in('status', ['confirmed', 'completed'])
    .order('start_time', { ascending: false });

  if (!appointments) return Response.json({ error: 'No data' }, { status: 500 });

  // ... rest of the stats calculation is identical to current code ...
  const todayApps = appointments.filter(a => new Date(a.start_time) >= dayStart);
  const monthApps = appointments.filter(a => new Date(a.start_time) >= monthStart);
  const yearApps = appointments.filter(a => new Date(a.start_time) >= yearStart);

  const monthClientIds = new Set(monthApps.map(a => a.client_id).filter(Boolean));
  const yearClientIds = new Set(yearApps.map(a => a.client_id).filter(Boolean));

  const avgTicket = monthApps.length > 0
    ? monthApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / monthApps.length / 100
    : 0;

  const monthlyRevenue = monthApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / 100;
  const yearlyRevenue = yearApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / 100;

  const clientSpending: Record<string, number> = {};
  for (const a of appointments) {
    if (!a.client_id) continue;
    clientSpending[a.client_id] = (clientSpending[a.client_id] || 0) + ((a.service as any)?.price_cents || 0);
  }
  const clientCount = Object.keys(clientSpending).length;
  const avgLTV = clientCount > 0
    ? Math.round(Object.values(clientSpending).reduce((s, v) => s + v, 0) / clientCount / 100)
    : 0;

  const channelCounts: Record<string, number> = {};
  for (const a of monthApps) {
    channelCounts[a.source] = (channelCounts[a.source] || 0) + 1;
  }

  return Response.json({
    today: {
      appointments: todayApps.length,
      clients: new Set(todayApps.map(a => a.client_id).filter(Boolean)).size,
      revenue: todayApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / 100,
    },
    month: { appointments: monthApps.length, clients: monthClientIds.size, revenue: monthlyRevenue, avgTicket },
    year: { appointments: yearApps.length, clients: yearClientIds.size, revenue: yearlyRevenue },
    avgLTV,
    channels: channelCounts,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/stats/route.ts
git commit -m "fix: replace admin client with server client in stats API"
```

---

### Task 7: State Management — useCalendarData Hook

**Files:**
- Create: `src/lib/hooks/useCalendarData.ts`
- Modify: `src/app/(dashboard)/calendar/page.tsx` (use the hook, add error handling)

- [ ] **Step 1: Create `src/lib/hooks/useCalendarData.ts`**

```typescript
'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Appointment, Service, Client, User, TimeBlock } from '@/lib/types';
import { format } from 'date-fns';
import { toast } from 'sonner';

export interface CalendarData {
  appointments: Appointment[];
  services: Service[];
  clients: Client[];
  stylists: Pick<User, 'id' | 'full_name'>[];
  timeBlocks: TimeBlock[];
  salonHours: { open: string; close: string };
  loading: boolean;
  error: string | null;
}

export function useCalendarData(salonId: string, date: Date | null) {
  const [data, setData] = useState<CalendarData>({
    appointments: [], services: [], clients: [], stylists: [],
    timeBlocks: [], salonHours: { open: '09:00', close: '19:00' },
    loading: false, error: null,
  });

  const supabase = createClient();

  const loadData = useCallback(async () => {
    if (!salonId || !date) return;
    setData(prev => ({ ...prev, loading: true, error: null }));

    try {
      const dateStr = format(date, 'yyyy-MM-dd');

      const [appsRes, svcRes] = await Promise.all([
        fetch(`/api/appointments?salon_id=${salonId}&date=${dateStr}`).then(r => {
          if (!r.ok) throw new Error(`Appointments: ${r.status}`);
          return r.json();
        }),
        fetch(`/api/services?salon_id=${salonId}`).then(r => {
          if (!r.ok) throw new Error(`Services: ${r.status}`);
          return r.json();
        }),
      ]);

      const [
        { data: clientsData },
        { data: stylistsData },
        { data: salonData },
      ] = await Promise.all([
        supabase.from('clients').select('*').eq('salon_id', salonId).order('last_name'),
        supabase.from('users').select('id, full_name').eq('salon_id', salonId).eq('role', 'stylist'),
        supabase.from('salons').select('working_hours, open_time, close_time').eq('id', salonId).single(),
      ]);

      // Fetch time blocks
      let timeBlocks: TimeBlock[] = [];
      try {
        const tbRes = await fetch(`/api/time-blocks?salon_id=${salonId}`);
        if (tbRes.ok) timeBlocks = await tbRes.json();
      } catch { /* time blocks are non-critical */ }

      // Compute salon hours for selected date
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const todayName = dayNames[date.getDay()];
      let salonHours = { open: '09:00', close: '19:00' };
      if (salonData) {
        let wh = salonData.working_hours as Record<string, any> | null;
        if (typeof wh === 'string') try { wh = JSON.parse(wh); } catch {}
        const dayHours = wh?.[todayName];
        if (wh?.[todayName] === null) {
          salonHours = { open: '00:00', close: '00:00' };
        } else {
          salonHours = {
            open: dayHours?.open || salonData.open_time || '09:00',
            close: dayHours?.close || salonData.close_time || '19:00',
          };
        }
      }

      setData({
        appointments: Array.isArray(appsRes) ? appsRes : [],
        services: Array.isArray(svcRes) ? svcRes : [],
        clients: clientsData || [],
        stylists: stylistsData || [],
        timeBlocks: Array.isArray(timeBlocks) ? timeBlocks : [],
        salonHours,
        loading: false,
        error: null,
      });
    } catch (err: any) {
      const msg = err.message || 'Errore caricamento dati';
      setData(prev => ({ ...prev, loading: false, error: msg }));
      toast.error(msg);
    }
  }, [salonId, date, supabase]);

  // Load on mount and when dependencies change
  useEffect(() => { loadData(); }, [loadData]);

  // Refresh on window focus (sync across tabs/pages)
  useEffect(() => {
    const onFocus = () => loadData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadData]);

  return { ...data, refresh: loadData };
}
```

- [ ] **Step 2: Refactor `src/app/(dashboard)/calendar/page.tsx` to use the hook**

Replace the manual fetch logic with the hook. The key changes:
- Replace `useState` for appointments/services/clients/stylists/timeBlocks/salonHours with `useCalendarData`
- Remove the inline `loadData` function
- Use `refresh` after save/delete

```typescript
'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarHeader } from './components/CalendarHeader';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { AppointmentModal } from './components/AppointmentModal';
import { useCalendarData } from '@/lib/hooks/useCalendarData';
import { todayDateStr } from '@/lib/date-utils';
import type { Appointment, TimeBlock } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function CalendarPage() {
  const [date, setDate] = useState<Date | null>(null);
  useEffect(() => { if (!date) setDate(new Date()); }, []);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockForm, setBlockForm] = useState({ stylist_id: '', date: todayDateStr(), start: '12:00', end: '13:00', reason: '' });
  const [salonId, setSalonId] = useState('');

  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (!users?.salon_id) return;
      setSalonId(users.salon_id);
    });
  }, []);

  const { appointments, services, clients, stylists, timeBlocks, salonHours, loading, refresh } = useCalendarData(salonId, date);

  if (!date) return <div className="p-8 text-center text-gray-400">Caricamento calendario...</div>;

  // Time block handler
  async function handleDeleteBlock(blockId: string) {
    await fetch(`/api/time-blocks?id=${blockId}`, { method: 'DELETE' });
    refresh();
  }

  function handleNewAppointment() {
    setSelectedAppointment({} as Appointment);
  }

  async function handleSave(form: Record<string, any>) {
    if (form.start_time && new Date(form.start_time) < new Date()) {
      toast.error('Non puoi prenotare nel passato');
      return;
    }

    const isNew = !form.id;
    const body = { ...form, salon_id: salonId, source: form.source || 'manual' };
    setSelectedAppointment(null);

    const url = isNew ? '/api/appointments' : `/api/appointments/${form.id}`;
    const method = isNew ? 'POST' : 'PATCH';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(isNew ? 'Creato' : 'Aggiornato');
        refresh();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Errore');
      }
    } catch {
      toast.error('Errore di connessione');
      refresh();
    }
  }

  function handleDelete(id: string) {
    setSelectedAppointment(null);
    fetch(`/api/appointments/${id}`, { method: 'DELETE' })
      .then(() => refresh())
      .catch(() => toast.error('Errore cancellazione'));
  }

  return (
    <div>
      <CalendarHeader date={date} view={view} onDateChange={setDate} onViewChange={setView} onNewAppointment={handleNewAppointment} onNewBlock={() => setShowBlockModal(true)} />
      <div className="mx-0 md:mx-4 mt-0 md:mt-4">
        {view === 'day' && (
          <DayView
            date={date} stylists={stylists} appointments={appointments} timeBlocks={timeBlocks} salonHours={salonHours}
            onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
            onAppointmentClick={setSelectedAppointment}
            onDeleteBlock={handleDeleteBlock}
          />
        )}
        {view === 'week' && (
          <WeekView
            date={date} stylists={stylists} appointments={appointments} timeBlocks={timeBlocks}
            onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
            onAppointmentClick={setSelectedAppointment}
            onDeleteBlock={handleDeleteBlock}
          />
        )}
        {loading && (
          <div className="h-1 bg-blue-100 w-full overflow-hidden">
            <div className="h-full bg-blue-500 animate-pulse" style={{ width: '60%' }} />
          </div>
        )}
      </div>
      {selectedAppointment && (
        <AppointmentModal
          appointment={selectedAppointment}
          services={services} clients={clients} stylists={stylists} salonId={salonId}
          onClose={() => setSelectedAppointment(null)}
          onSave={handleSave} onDelete={handleDelete}
        />
      )}

      {/* Time block modal (unchanged from current code) */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBlockModal(false)}>
          {/* ... same block modal content as current code, call refresh() after create/delete ... */}
        </div>
      )}
    </div>
  );
}
```

Note: The time block modal code (lines 189-271 in current file) stays structurally identical. The two changes needed:
1. After successful block creation (line 258): add `refresh();` after `setTimeBlocks(...)`
2. After block deletion (line 209): add `refresh();` after the fetch

```typescript
// Inside the "Nuova fascia" save button onClick (around line 263):
if (res.ok) {
  const block = await res.json();
  setTimeBlocks(prev => [...prev, block]);
  setBlockForm({ stylist_id: '', date: todayDateStr(), start: '12:00', end: '13:00', reason: '' });
  refresh();
}

// Inside the delete button onClick (around line 209):
await fetch(`/api/time-blocks?id=${b.id}`, { method: 'DELETE' });
refresh();
```

- [ ] **Step 3: Commit**

```bash
mkdir -p src/lib/hooks
git add src/lib/hooks/useCalendarData.ts src/app/\(dashboard\)/calendar/page.tsx
git commit -m "feat: useCalendarData hook with focus refresh and error handling"
```

---

### Task 8: Calendar UX — DayView Improvements

**Files:**
- Modify: `src/app/(dashboard)/calendar/components/DayView.tsx`

- [ ] **Step 1: Update DayView — visible free slots, block confirm dialog, richer cards**

Key changes:
1. Free slots always show "+ Prenota" (not just on hover)
2. Clicking a blocked slot shows `confirm()` dialog instead of immediate deletion
3. Pass through the improved AppointmentCard (already good from existing code)

```typescript
'use client';
import { format, setHours, setMinutes, parseISO, addMinutes } from 'date-fns';
import { AppointmentCard } from './AppointmentCard';
import type { Appointment, User, TimeBlock } from '@/lib/types';

interface Props {
  date: Date;
  stylists: Pick<User, 'id' | 'full_name'>[];
  appointments: Appointment[];
  timeBlocks: TimeBlock[];
  salonHours: { open: string; close: string };
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onDeleteBlock: (blockId: string) => void;
}

const STYLIST_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24'];

function isToday(d: Date): boolean {
  return format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
}

export function DayView({ date, stylists, appointments, timeBlocks, salonHours, onSlotClick, onAppointmentClick, onDeleteBlock }: Props) {
  const openH = parseInt(salonHours.open.split(':')[0]);
  const closeH = parseInt(salonHours.close.split(':')[0]);

  // If salon is closed (hours 00:00 - 00:00), show closed message
  if (closeH <= openH) {
    return (
      <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">
        <p className="text-lg font-medium">Salone chiuso</p>
        <p className="text-sm mt-1">Nessun orario di apertura per questa data</p>
      </div>
    );
  }

  const hours = Array.from({ length: closeH - openH }, (_, i) => i + openH);
  const today = isToday(date);

  if (stylists.length === 0) {
    return <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">Nessun operatore configurato</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] md:h-[calc(100vh-160px)] overflow-hidden bg-white rounded-none md:rounded-xl border-0 md:border shadow-sm">
      <div className="flex border-b bg-gray-50/50 sticky top-0 z-10 rounded-t-xl">
        <div className="w-14 flex-shrink-0 p-2" />
        {stylists.map((s, i) => (
          <div key={s.id} className="flex-1 p-3 text-center font-semibold text-sm border-l border-gray-100 flex items-center justify-center gap-2 bg-white/60">
            <div className="w-3 h-3 rounded-full ring-2 ring-offset-1 ring-gray-200" style={{ backgroundColor: STYLIST_COLORS[i % STYLIST_COLORS.length] }} />
            {s.full_name}
          </div>
        ))}
      </div>

      <div className="flex flex-1 overflow-auto">
        <div className="w-14 flex-shrink-0 bg-gray-50/30">
          {hours.map(h => (
            <div key={h} className={`h-20 border-b border-gray-100 text-[11px] text-gray-400 text-right pr-2 pt-0.5 font-medium ${
              today && new Date().getHours() === h ? 'bg-blue-50/50 text-blue-500' : ''
            }`}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {stylists.map(stylist => (
          <div key={stylist.id} className="flex-1 border-l border-gray-100">
            {hours.map(h => {
              const slotStart = setMinutes(setHours(date, h), 0);
              const slotEnd = addMinutes(slotStart, 60);
              const slotApps = appointments.filter(a => {
                if (a.status === 'cancelled') return false;
                const start = parseISO(a.start_time);
                return a.stylist_id === stylist.id && start >= slotStart && start < slotEnd;
              });
              const blockForSlot = timeBlocks.find(b => {
                if (b.stylist_id && b.stylist_id !== stylist.id) return false;
                const bStart = parseISO(b.start_time);
                const bEnd = parseISO(b.end_time);
                return slotStart < bEnd && slotEnd > bStart;
              });
              const isBlocked = Boolean(blockForSlot);
              const isCurrentHour = today && new Date().getHours() === h;
              const isPastHour = today && slotEnd < new Date();

              return (
                <div key={h}
                  className={`h-20 border-b border-gray-50 p-0.5 transition-colors group relative ${
                    isPastHour ? 'bg-gray-100/50 cursor-not-allowed opacity-40' :
                    isBlocked ? 'bg-red-50/40' :
                    isCurrentHour ? 'bg-blue-50/30 cursor-pointer' : 'hover:bg-gray-50/50 cursor-pointer'
                  }`}
                  onClick={() => {
                    if (isPastHour) return;
                    if (isBlocked) {
                      // Confirm before removing block
                      if (confirm(`Rimuovere il blocco${blockForSlot?.reason ? ` "${blockForSlot.reason}"` : ''}?`)) {
                        onDeleteBlock(blockForSlot!.id);
                      }
                    } else if (slotApps.length === 0) {
                      onSlotClick(stylist.id, format(slotStart, "yyyy-MM-dd'T'HH:mm:ssXXX"));
                    }
                  }}>

                  {isBlocked && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      <div className="w-full border-t-2 border-red-300 rotate-12" />
                      <span className="absolute text-[10px] text-red-500 font-medium bg-white/90 px-2 py-0.5 rounded-full shadow-sm border border-red-200">
                        {blockForSlot?.reason || 'Non disp.'} (click rimuove)
                      </span>
                    </div>
                  )}

                  {slotApps.map(app => (
                    <AppointmentCard key={app.id} appointment={app}
                      onClick={(e) => { e?.stopPropagation?.(); onAppointmentClick(app); }} />
                  ))}

                  {slotApps.length === 0 && !isBlocked && !isPastHour && (
                    <div className="h-full flex items-center justify-center">
                      <span className="text-[10px] text-gray-300 border border-dashed border-gray-200 rounded px-2 py-1 opacity-60 group-hover:opacity-100 group-hover:border-blue-300 group-hover:text-blue-400 group-hover:bg-blue-50/50 transition-all">
                        + Prenota
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/calendar/components/DayView.tsx
git commit -m "feat: DayView - visible free slots, block confirm dialog, closed salon message"
```

---

### Task 9: Calendar UX — WeekView Improvements & Remove MonthView

**Files:**
- Modify: `src/app/(dashboard)/calendar/components/WeekView.tsx` (richer cards, block confirm)
- Delete: `src/app/(dashboard)/calendar/components/MonthView.tsx`
- Modify: `src/app/(dashboard)/calendar/components/CalendarHeader.tsx` (remove Month toggle)
- Modify: `src/app/(dashboard)/calendar/page.tsx` (remove MonthView import, remove 'month' state)

- [ ] **Step 1: Update WeekView — block confirm dialog**

In `WeekView.tsx`, update the `onClick` handler for blocked days to use `confirm()` instead of immediate delete:

```typescript
// Replace the onClick handler (lines 67-77):
onClick={() => {
  if (dayBlocked) {
    const block = timeBlocks.find(b => {
      if (b.stylist_id && b.stylist_id !== stylist.id) return false;
      return isSameDay(parseISO(b.start_time), d) || isSameDay(parseISO(b.end_time), d);
    });
    if (block && confirm(`Rimuovere il blocco${block.reason ? ` "${block.reason}"` : ''}?`)) {
      onDeleteBlock(block.id);
    }
  } else {
    onSlotClick(stylist.id, format(d, "yyyy-MM-dd'T'08:00:00XXX"));
  }
}}
```

- [ ] **Step 2: Remove MonthView.tsx**

```bash
rm src/app/\(dashboard\)/calendar/components/MonthView.tsx
```

- [ ] **Step 3: Update CalendarHeader — remove Month toggle**

No changes needed — the header already only has `'day' | 'week'` toggle (lines 32-37). The `view` prop type `'day' | 'week'` (line 8) already excludes 'month'.

- [ ] **Step 4: Update calendar/page.tsx — remove MonthView import**

Remove: `import { MonthView } from './components/MonthView';` (if present — it isn't in the current code, so skip this step)

The `view` state type is already `'day' | 'week'` (line 18 of current code). No changes needed.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/calendar/components/WeekView.tsx src/app/\(dashboard\)/calendar/page.tsx
git rm src/app/\(dashboard\)/calendar/components/MonthView.tsx
git commit -m "feat: WeekView block confirm dialog, remove MonthView"
```

---

### Task 10: Modal UX — AppointmentModal Redesign

**Files:**
- Modify: `src/app/(dashboard)/calendar/components/AppointmentModal.tsx`

- [ ] **Step 1: Rewrite AppointmentModal with improved UX**

Full rewritten component following the spec:
- Reordered fields: Service → Stylist → Date/Time → Client → (Channel, Notes collapsible)
- 3-column slot grid instead of 4
- 7 days with day name + date on two lines
- Tab-style client selector (large, clear)
- Inline errors near fields
- `max-h-[85vh]` on the scroll container

```typescript
'use client';
import { useState, useEffect } from 'react';
import { X, Trash2, Loader2, ChevronDown } from 'lucide-react';
import type { Appointment, Service, Client, User } from '@/lib/types';
import { format, parseISO, addDays } from 'date-fns';
import { it } from 'date-fns/locale';
import { formatPhone, countryCodes } from '@/lib/utils';
import { todayDateStr, buildSlotTime } from '@/lib/date-utils';

interface Props {
  appointment: Appointment | null;
  services: Service[];
  clients: Client[];
  stylists: Pick<User, 'id' | 'full_name'>[];
  salonId: string;
  onClose: () => void;
  onSave: (data: Record<string, any>) => void;
  onDelete: (id: string) => void;
}

export function AppointmentModal({ appointment, services, clients, stylists, salonId, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<Partial<Appointment>>({});
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [newClient, setNewClient] = useState({ first_name: '', last_name: '', phone: '' });
  const [clientPrefix, setClientPrefix] = useState('+39');
  const [slots, setSlots] = useState<{ time: string; stylist_id: string; stylist_name: string }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotDate, setSlotDate] = useState(todayDateStr());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const isNew = !appointment?.id;

  // Error state per field
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm(appointment || {});
    if (appointment?.client_id) setClientMode('existing');
    if (appointment?.start_time) setSlotDate(format(parseISO(appointment.start_time), 'yyyy-MM-dd'));
  }, [appointment]);

  useEffect(() => {
    if (!salonId || !form.service_id || !form.stylist_id || !slotDate) return;
    setSlotsLoading(true);
    fetch(`/api/slots?salon_id=${salonId}&service_id=${form.service_id}&stylist_id=${form.stylist_id}&date=${slotDate}`)
      .then(r => r.json())
      .then(d => { setSlots(Array.isArray(d) ? d : []); setSlotsLoading(false); });
  }, [salonId, form.service_id, form.stylist_id, slotDate]);

  if (!appointment) return null;

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  async function handleSave() {
    const errs: Record<string, string> = {};
    if (!form.service_id) errs.service = 'Seleziona un servizio';
    if (!form.stylist_id) errs.stylist = 'Seleziona un operatore';
    if (!form.start_time) errs.time = 'Seleziona un orario';
    if (clientMode === 'new') {
      if (!newClient.first_name) errs.clientFirst = 'Nome richiesto';
      if (!newClient.last_name) errs.clientLast = 'Cognome richiesto';
    }
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSaving(true);
    try {
      const data = clientMode === 'new'
        ? { ...form, client_id: undefined, client: { ...newClient, phone: formatPhone(clientPrefix + newClient.phone.replace(/\s/g, '')) } }
        : form;
      await onSave(data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{isNew ? 'Nuovo Appuntamento' : 'Modifica Appuntamento'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>

        <div className="space-y-4 max-h-[80vh] overflow-y-auto">

          {/* 1. Servizio */}
          <div>
            <label className="text-sm font-medium text-gray-700">Servizio</label>
            <select className={`w-full border rounded-lg px-3 py-2 mt-1 text-sm ${errors.service ? 'border-red-400' : ''}`}
              value={form.service_id || ''}
              onChange={e => { setForm(f => ({ ...f, service_id: e.target.value, start_time: '' })); clearError('service'); }}>
              <option value="">Seleziona servizio...</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes}min · €{(s.price_cents/100).toFixed(2)}</option>)}
            </select>
            {errors.service && <p className="text-red-500 text-xs mt-1">{errors.service}</p>}
          </div>

          {/* 2. Operatore */}
          <div>
            <label className="text-sm font-medium text-gray-700">Operatore</label>
            <select className={`w-full border rounded-lg px-3 py-2 mt-1 text-sm ${errors.stylist ? 'border-red-400' : ''}`}
              value={form.stylist_id || ''}
              onChange={e => { setForm(f => ({ ...f, stylist_id: e.target.value, start_time: '' })); clearError('stylist'); }}>
              <option value="">Seleziona operatore...</option>
              {stylists.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            {errors.stylist && <p className="text-red-500 text-xs mt-1">{errors.stylist}</p>}
          </div>

          {/* 3. Data e Orario */}
          <div>
            <label className="text-sm font-medium text-gray-700">Data e orario</label>
            {errors.time && <p className="text-red-500 text-xs mt-1">{errors.time}</p>}

            {/* Date picker — 7 days */}
            <div className="flex gap-1.5 overflow-x-auto mt-1.5 mb-2">
              {Array.from({ length: 7 }, (_, i) => addDays(new Date(), i)).map(d => {
                const ds = format(d, 'yyyy-MM-dd');
                return (
                  <button key={ds} type="button"
                    onClick={() => { setSlotDate(ds); setForm(f => ({ ...f, start_time: '' })); clearError('time'); }}
                    className={`flex-shrink-0 w-14 py-2 rounded-xl text-center transition-colors ${
                      ds === slotDate ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    <div className="text-[10px] leading-tight">{format(d, 'EEE', { locale: it })}</div>
                    <div className="font-bold text-base leading-tight">{format(d, 'd')}</div>
                  </button>
                );
              })}
            </div>

            {/* Slot grid — 3 columns */}
            {!form.service_id || !form.stylist_id ? (
              <p className="text-xs text-gray-400 text-center py-2">Seleziona servizio e operatore</p>
            ) : slotsLoading ? (
              <div className="flex items-center justify-center py-3"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
            ) : slots.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">Nessuno slot disponibile</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto">
                {slots.map((s, i) => {
                  const isSelected = form.start_time
                    ? form.start_time.startsWith(`${slotDate}T${s.time}:00`)
                    : false;
                  return (
                    <button key={i} type="button"
                      onClick={() => { setForm(f => ({ ...f, start_time: buildSlotTime(slotDate, s.time) })); clearError('time'); }}
                      className={`py-2.5 px-1 rounded-lg text-xs font-semibold transition-all ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-green-50 border border-green-200 text-green-800 hover:bg-green-100'
                      }`}>
                      {s.time}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4. Cliente */}
          <div>
            <label className="text-sm font-medium text-gray-700">Cliente</label>
            <div className="flex bg-gray-100 rounded-lg p-0.5 mt-1.5 mb-2">
              <button onClick={() => setClientMode('existing')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${clientMode === 'existing' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                Cliente esistente
              </button>
              <button onClick={() => setClientMode('new')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${clientMode === 'new' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                Nuovo cliente
              </button>
            </div>

            {clientMode === 'existing' ? (
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.client_id || ''}
                onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                <option value="">Seleziona cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
              </select>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input type="text" placeholder="Nome *" value={newClient.first_name}
                      onChange={e => { setNewClient({ ...newClient, first_name: e.target.value }); clearError('clientFirst'); }}
                      className={`w-full px-3 py-2 border rounded-lg text-sm ${errors.clientFirst ? 'border-red-400' : ''}`} />
                    {errors.clientFirst && <p className="text-red-500 text-xs mt-0.5">{errors.clientFirst}</p>}
                  </div>
                  <div className="flex-1">
                    <input type="text" placeholder="Cognome *" value={newClient.last_name}
                      onChange={e => { setNewClient({ ...newClient, last_name: e.target.value }); clearError('clientLast'); }}
                      className={`w-full px-3 py-2 border rounded-lg text-sm ${errors.clientLast ? 'border-red-400' : ''}`} />
                    {errors.clientLast && <p className="text-red-500 text-xs mt-0.5">{errors.clientLast}</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <select value={clientPrefix} onChange={e => setClientPrefix(e.target.value)}
                    className="px-2 py-2 border rounded-lg text-sm bg-gray-50 w-24">
                    {countryCodes.slice(0, 8).map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                  </select>
                  <input type="tel" placeholder="Telefono" value={newClient.phone}
                    onChange={e => setNewClient({ ...newClient, phone: e.target.value.replace(/[^\d\s\-\(\)]/g, '') })}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
            )}
          </div>

          {/* 5. Advanced: Canale + Note (collapsible) */}
          <div>
            <button type="button" onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <ChevronDown size={14} className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              Dettagli aggiuntivi
            </button>
            {advancedOpen && (
              <div className="space-y-3 mt-2 pl-1">
                <div>
                  <label className="text-sm text-gray-500">Canale</label>
                  <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
                    value={form.source || 'manual'}
                    onChange={e => setForm(f => ({ ...f, source: e.target.value as any }))}>
                    <option value="walk_in">🚶 Walk-in</option>
                    <option value="phone">📞 Telefono</option>
                    <option value="whatsapp">💬 WhatsApp</option>
                    <option value="widget">📱 Sito/Widget</option>
                    <option value="manual">✍️ Manuale</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Note</label>
                  <textarea className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" rows={2}
                    value={form.notes || ''}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end pt-2 border-t">
            {!isNew && (
              <button
                onClick={() => { if (confirm('Sicuro di voler cancellare questo appuntamento?')) onDelete(appointment.id); }}
                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1 text-sm">
                <Trash2 size={16} /> Elimina
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Annulla</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
              {saving ? 'Salvataggio...' : 'Salva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/calendar/components/AppointmentModal.tsx
git commit -m "feat: redesign AppointmentModal - reorder fields, 3-col slots, tab client, inline errors"
```

---

### Task 11: Navigation — PageHeader & Layout

**Files:**
- Create: `src/lib/components/PageHeader.tsx`
- Modify: `src/app/(dashboard)/layout.tsx` (optional: loading indicator)

- [ ] **Step 1: Create `src/lib/components/PageHeader.tsx`**

```typescript
import { ReactNode } from 'react';

interface Props {
  title: string;
  breadcrumb?: { label: string; href?: string }[];
  action?: ReactNode;
}

export function PageHeader({ title, breadcrumb, action }: Props) {
  return (
    <div className="flex items-center justify-between py-3 px-4 border-b border-gray-100 bg-white">
      <div>
        {breadcrumb && breadcrumb.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-gray-400 uppercase tracking-wide mb-0.5">
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                {item.href ? (
                  <a href={item.href} className="hover:text-gray-600">{item.label}</a>
                ) : (
                  <span>{item.label}</span>
                )}
              </span>
            ))}
          </div>
        )}
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Add loading indicator to dashboard layout**

In `src/app/(dashboard)/layout.tsx`, add a thin loading bar that appears during page transitions. The simplest way is to use Next.js's built-in loading state — but since this is a client component, we add a small top bar inside the layout:

No structural changes needed to the layout — the loading bar is rendered per-page via the `useCalendarData` hook (already added in Task 7). Each page can import `PageHeader` and use it.

- [ ] **Step 3: Commit**

```bash
mkdir -p src/lib/components
git add src/lib/components/PageHeader.tsx
git commit -m "feat: PageHeader component with breadcrumb and action slot"
```

---

### Task 12: Branding — Metadata, Favicon, Login

**Files:**
- Modify: `src/app/layout.tsx` (metadata title/description)
- Modify: `src/app/login/page.tsx` (branding text)

- [ ] **Step 1: Update metadata in `src/app/layout.tsx`**

```typescript
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LocalVista Gestionale Parrucchieri',
  description: 'Piattaforma gestionale per saloni di parrucchieri',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Update login page branding**

In `src/app/login/page.tsx`, update the branding text (line 36-37):

```typescript
// Replace lines 36-37:
// <h1 className="text-2xl font-bold text-white">LocalVista</h1>
// <p className="text-gray-400 text-sm mt-1">Gestionale parrucchieri</p>
<h1 className="text-2xl font-bold text-white">LocalVista</h1>
<p className="text-gray-400 text-sm mt-1">Gestionale Parrucchieri</p>
```

- [ ] **Step 3: Favicon**

Replace `src/app/favicon.ico` with a LocalVista-branded favicon. Since we can't create an image file in code, add a note for the user:

```bash
# The current favicon is Vercel's default (src/app/favicon.ico)
# The user should replace it with a LocalVista-branded favicon
# For now, we can use a simple SVG favicon via the metadata:
```

Alternatively, generate a simple favicon via the layout metadata using an inline SVG icon route. But the simplest approach: just note that the file needs replacement. The metadata update (Step 1) already sets the page title, which is what shows in browser tabs.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/login/page.tsx
git commit -m "feat: LocalVista branding - metadata, login page text"
```

---

### Task 13: Final Verification

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Fix any type errors found.

- [ ] **Step 2: Run linter**

```bash
npm run lint
```

Fix any lint errors found.

- [ ] **Step 3: Start dev server and smoke test**

```bash
npm run dev
```

Verify:
- Calendar loads without errors (http://localhost:3000/calendar)
- Day view shows appointments with "+ Prenota" visible on free slots
- Week view shows appointments
- Creating a new appointment works (click "+ Prenota" → modal → save)
- Modal shows reordered fields (Service → Stylist → Date → Client)
- Modal slots show in 3-column grid
- Block creation/deletion works with confirmation dialog
- Dashboard shows stats correctly
- Login page shows "LocalVista Gestionale Parrucchieri"
- Browser tab shows "LocalVista Gestionale Parrucchieri"
- No timezone errors in console

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final verification fixes"
```
