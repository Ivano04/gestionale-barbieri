# Stylist-Services Assignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere di assegnare a ogni stylist solo i servizi che può svolgere, con default retrocompatibile (nessuna assegnazione = tutti i servizi).

**Architecture:** Nuova junction table `stylist_services`, nuova API REST `GET/POST /api/stylist-services`, modifica `fetchStylists()` per filtrare per servizio, UI su pagine Staff e Servizi, dropdown operatore filtrata nella modale appuntamento.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Tailwind CSS, Lucide React

---

### Task 1: Migration database

**Files:**
- Create: `supabase/migrations/007_stylist_services.sql`
- Modify: `src/lib/types/index.ts`

- [ ] **Step 1: Creare la migration SQL**

```sql
-- Migration 007: stylist-services assignment
CREATE TABLE IF NOT EXISTS public.stylist_services (
  stylist_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (stylist_id, service_id)
);

ALTER TABLE public.stylist_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "StylistServices read salon" ON public.stylist_services FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid()
    AND salon_id = (SELECT salon_id FROM public.users WHERE id = stylist_services.stylist_id)
  ));

CREATE POLICY "StylistServices write admin" ON public.stylist_services FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY "StylistServices delete admin" ON public.stylist_services FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('owner', 'admin')
  ));
```

- [ ] **Step 2: Aggiungere StylistServiceAssignment al tipo in `src/lib/types/index.ts`**

In fondo al file, dopo `SwapSuggestion`, aggiungere:

```typescript
/** Stylist-service assignment */
export interface StylistServiceAssignment {
  stylist_id: string;
  service_id: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_stylist_services.sql src/lib/types/index.ts
git commit -m "feat: migration e tipo per stylist_services"
```

---

### Task 2: API stylist-services

**File:**
- Create: `src/app/api/stylist-services/route.ts`

- [ ] **Step 1: Creare il file API**

```typescript
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** GET /api/stylist-services?salon_id=X&stylist_id=Y — get assigned services for a stylist */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const stylist_id = searchParams.get('stylist_id');

  if (!salon_id || !stylist_id) {
    return Response.json({ error: 'salon_id and stylist_id required' }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('stylist_services')
    .select('service_id')
    .eq('stylist_id', stylist_id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data.map((r: { service_id: string }) => r.service_id));
}

/** POST /api/stylist-services — replace all assignments for a stylist */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { stylist_id, service_ids } = body;
  if (!stylist_id || !Array.isArray(service_ids)) {
    return Response.json({ error: 'stylist_id and service_ids[] required' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // Delete all existing assignments for this stylist
  await adminSupabase.from('stylist_services').delete().eq('stylist_id', stylist_id);

  // Insert new assignments (skip if empty array — means "all services")
  if (service_ids.length > 0) {
    const rows = service_ids.map((service_id: string) => ({ stylist_id, service_id }));
    const { error } = await adminSupabase.from('stylist_services').insert(rows);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ stylist_id, service_ids });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/stylist-services/route.ts
git commit -m "feat: API CRUD per stylist-services"
```

---

### Task 3: Modificare fetchStylists per filtrare per servizio

**File:**
- Modify: `src/services/booking-engine/queries.ts`

- [ ] **Step 1: Aggiungere parametro `service_id` a `fetchStylists`**

Sostituire la funzione `fetchStylists` esistente (righe 50-60) con:

```typescript
export async function fetchStylists(salonId: string, stylistId?: string, serviceId?: string) {
  const supabase = createAdminClient();

  // If a service is specified, check which stylists are explicitly assigned to it
  if (serviceId) {
    const { data: assignments } = await supabase
      .from('stylist_services')
      .select('stylist_id');

    // If any stylist has explicit assignments, filter by those
    if (assignments && assignments.length > 0) {
      const assignedStylistIds = [...new Set(assignments.map(a => a.stylist_id))];

      // Get the service-specific assignments
      const { data: serviceAssignments } = await supabase
        .from('stylist_services')
        .select('stylist_id')
        .eq('service_id', serviceId);

      const eligibleIds = serviceAssignments?.map(a => a.stylist_id) || [];

      // If no stylist is assigned to this specific service, return empty
      if (eligibleIds.length === 0) return [];

      let query = supabase
        .from('users')
        .select('id, full_name, working_hours')
        .eq('salon_id', salonId)
        .eq('role', 'stylist')
        .in('id', eligibleIds);

      if (stylistId) query = query.eq('id', stylistId);
      const { data: stylists } = await query;
      return stylists || [];
    }
  }

  // Default: no filtering — all stylists can do all services
  let query = supabase
    .from('users')
    .select('id, full_name, working_hours')
    .eq('salon_id', salonId)
    .eq('role', 'stylist');

  if (stylistId) query = query.eq('id', stylistId);
  const { data: stylists } = await query;
  return stylists || [];
}
```

- [ ] **Step 2: Aggiornare il chiamante in `getAvailableSlots`**

In `src/services/booking-engine/index.ts`, riga 30, cambiare:

```typescript
const stylists = await fetchStylists(salon_id, stylist_id);
```

in:

```typescript
const stylists = await fetchStylists(salon_id, stylist_id, service_id);
```

- [ ] **Step 3: Commit**

```bash
git add src/services/booking-engine/queries.ts src/services/booking-engine/index.ts
git commit -m "feat: fetchStylists filtra per service_id"
```

---

### Task 4: UI — Pagina Staff (checkbox servizi per stylist)

**File:**
- Modify: `src/app/(dashboard)/staff/page.tsx`

- [ ] **Step 1: Aggiungere import e tipi**

Sostituire l'import di lucide-react (riga 5):

```typescript
import { Users, Clock, Plus, Loader2, Scissors } from 'lucide-react';
```

Aggiungere l'import del tipo (riga 1):

```typescript
import type { Service } from '@/lib/types';
```

- [ ] **Step 2: Aggiungere stato per servizi e assegnazioni**

Dopo la riga `const [creating, setCreating] = useState(false);` aggiungere:

```typescript
const [allServices, setAllServices] = useState<Service[]>([]);
const [assignments, setAssignments] = useState<Record<string, string[]>>({});
const [savingServices, setSavingServices] = useState<string | null>(null);
```

- [ ] **Step 3: Caricare servizi e assegnazioni all'avvio**

Nel `useEffect` iniziale, dopo `setHours(h)`, aggiungere:

```typescript
// Load services
const { data: svcs } = await supabase.from('services').select('*').eq('salon_id', users.salon_id).order('name');
setAllServices(svcs || []);

// Load assignments for all stylists
const { data: assignData } = await supabase.from('stylist_services').select('stylist_id, service_id');
const assignMap: Record<string, string[]> = {};
(staff || []).forEach((s: any) => { assignMap[s.id] = []; });
(assignData || []).forEach((a: any) => {
  if (assignMap[a.stylist_id]) assignMap[a.stylist_id].push(a.service_id);
});
setAssignments(assignMap);
```

- [ ] **Step 4: Funzione toggle servizio e salva servizi**

Dopo la funzione `saveStylist`, aggiungere:

```typescript
function toggleService(stylistId: string, serviceId: string) {
  setAssignments(prev => {
    const current = prev[stylistId] || [];
    const updated = current.includes(serviceId)
      ? current.filter(id => id !== serviceId)
      : [...current, serviceId];
    return { ...prev, [stylistId]: updated };
  });
}

async function saveServices(stylistId: string) {
  setSavingServices(stylistId);
  const serviceIds = assignments[stylistId] || [];
  await fetch('/api/stylist-services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stylist_id: stylistId, service_ids: serviceIds }),
  });
  setSavingServices(null);
  toast.success('Servizi salvati');
}
```

- [ ] **Step 5: Aggiungere sezione "Servizi" nella UI espansa dello stylist**

Dopo il pulsante "Salva orari" (riga 209), prima del `</div>` di chiusura dell'espanso, aggiungere:

```tsx
<div className="mt-4 pt-4 border-t">
  <h4 className="text-sm font-medium text-gray-500 mb-3 flex items-center gap-2">
    <Scissors size={14} /> Servizi
  </h4>
  {allServices.length === 0 ? (
    <p className="text-xs text-gray-400">Nessun servizio configurato</p>
  ) : (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {allServices.map(svc => {
        const checked = (assignments[stylist.id] || []).includes(svc.id);
        return (
          <label key={svc.id} className="flex items-center gap-2 p-1.5 hover:bg-white rounded-lg cursor-pointer text-sm">
            <input type="checkbox" checked={checked}
              onChange={() => toggleService(stylist.id, svc.id)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: svc.color_hex }} />
            <span>{svc.name}</span>
            <span className="text-gray-400 text-xs ml-auto">{svc.duration_minutes}min</span>
          </label>
        );
      })}
    </div>
  )}
  <p className="text-[10px] text-gray-400 mt-2">
    {(assignments[stylist.id] || []).length === 0
      ? 'Nessuna selezione = tutti i servizi disponibili'
      : `${(assignments[stylist.id] || []).length} servizio/i assegnato/i`}
  </p>
  <button onClick={() => saveServices(stylist.id)} disabled={savingServices === stylist.id}
    className="mt-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
    {savingServices === stylist.id ? 'Salvataggio...' : 'Salva servizi'}
  </button>
</div>
```

- [ ] **Step 6: Commit**

```bash
git add src/app/(dashboard)/staff/page.tsx
git commit -m "feat: checkbox servizi nella pagina staff"
```

---

### Task 5: UI — Pagina Servizi (checkbox stylist per servizio)

**File:**
- Modify: `src/app/(dashboard)/services/page.tsx`

- [ ] **Step 1: Aggiungere import e stati**

Sostituire l'import di lucide-react (riga 4):

```typescript
import { Plus, X, Pencil, Trash2, Scissors } from 'lucide-react';
```

Aggiungere dopo `const [saving, setSaving] = useState(false);`:

```typescript
const [expandedService, setExpandedService] = useState<string | null>(null);
const [stylists, setStylists] = useState<any[]>([]);
const [assignments, setAssignments] = useState<Record<string, string[]>>({});
const [savingAssignments, setSavingAssignments] = useState<string | null>(null);
```

- [ ] **Step 2: Caricare stylist e assegnazioni**

Nel `useEffect`, dopo `setSalonId(users.salon_id)`, aggiungere:

```typescript
// Load stylists
const { data: staff } = await supabase.from('users')
  .select('id, full_name').eq('salon_id', users.salon_id).eq('role', 'stylist').order('full_name');
setStylists(staff || []);

// Load assignments (by service)
const { data: assignData } = await supabase.from('stylist_services').select('stylist_id, service_id');
const assignMap: Record<string, string[]> = {};
(assignData || []).forEach((a: any) => {
  if (!assignMap[a.service_id]) assignMap[a.service_id] = [];
  assignMap[a.service_id].push(a.stylist_id);
});
setAssignments(assignMap);
```

- [ ] **Step 3: Funzioni toggle e save per servizio**

Dopo `handleDelete`, aggiungere:

```typescript
function toggleStylist(serviceId: string, stylistId: string) {
  setAssignments(prev => {
    const current = prev[serviceId] || [];
    const updated = current.includes(stylistId)
      ? current.filter(id => id !== stylistId)
      : [...current, stylistId];
    return { ...prev, [serviceId]: updated };
  });
}

async function saveServiceAssignments(serviceId: string) {
  setSavingAssignments(serviceId);
  const serviceIds = assignments[serviceId] || [];
  // Update each stylist's assignments for this service
  for (const stylist of stylists) {
    const { data: current } = await supabase
      .from('stylist_services').select('service_id').eq('stylist_id', stylist.id);
    const currentIds = (current || []).map((r: any) => r.service_id);
    const hasService = serviceIds.includes(stylist.id);
    if (hasService && !currentIds.includes(serviceId)) {
      await fetch('/api/stylist-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stylist_id: stylist.id, service_ids: [...currentIds, serviceId] }),
      });
    } else if (!hasService && currentIds.includes(serviceId)) {
      await fetch('/api/stylist-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stylist_id: stylist.id, service_ids: currentIds.filter(id => id !== serviceId) }),
      });
    }
  }
  setSavingAssignments(null);
  toast.success('Assegnazioni salvate');
}
```

- [ ] **Step 4: Modificare la card servizio per mostrare checkbox stylist**

Sostituire il blocco della card (righe 121-133) con:

```tsx
<div key={s.id} className="bg-white rounded-xl border hover:shadow-md transition-shadow">
  <button onClick={() => setExpandedService(expandedService === s.id ? null : s.id)}
    className="w-full p-4 flex items-center gap-4 text-left">
    <div className="w-4 h-12 rounded-full" style={{ backgroundColor: s.color_hex }} />
    <div className="flex-1 min-w-0">
      <div className="font-semibold truncate">{s.name}</div>
      <div className="text-sm text-gray-500">{s.duration_minutes} min · €{(s.price_cents / 100).toFixed(2)}</div>
    </div>
    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
      <button onClick={() => openEdit(s)} className="p-2 hover:bg-gray-100 rounded-lg"><Pencil size={14} /></button>
      <button onClick={() => handleDelete(s.id)} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={14} /></button>
    </div>
  </button>

  {expandedService === s.id && (
    <div className="border-t px-4 py-3 bg-gray-50/50">
      <h4 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
        <Scissors size={14} /> Operatori
      </h4>
      {stylists.length === 0 ? (
        <p className="text-xs text-gray-400">Nessun operatore configurato</p>
      ) : (
        <div className="space-y-1">
          {stylists.map(st => {
            const checked = (assignments[s.id] || []).includes(st.id);
            return (
              <label key={st.id} className="flex items-center gap-2 p-1.5 hover:bg-white rounded-lg cursor-pointer text-sm">
                <input type="checkbox" checked={checked}
                  onChange={() => toggleStylist(s.id, st.id)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span>{st.full_name}</span>
              </label>
            );
          })}
        </div>
      )}
      <button onClick={() => saveServiceAssignments(s.id)} disabled={savingAssignments === s.id}
        className="mt-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
        {savingAssignments === s.id ? 'Salvataggio...' : 'Salva'}
      </button>
    </div>
  )}
</div>
```

- [ ] **Step 5: Aggiungere import toast**

In cima al file, aggiungere:

```typescript
import { toast } from 'sonner';
```

- [ ] **Step 6: Commit**

```bash
git add src/app/(dashboard)/services/page.tsx
git commit -m "feat: checkbox stylist nella pagina servizi"
```

---

### Task 6: Modale appuntamento — filtrare stylist per servizio

**File:**
- Modify: `src/app/(dashboard)/calendar/components/AppointmentModal.tsx`
- Modify: `src/app/(dashboard)/calendar/page.tsx`

- [ ] **Step 1: Passare `service_id` nel filtraggio stylist della modale**

La modale già chiama `/api/slots?service_id=X&stylist_id=Y` per caricare gli slot. L'API slots ora filtra già gli stylist (grazie alla modifica di `fetchStylists`). Quindi la dropdown "Operatore" nella modale deve mostrare solo gli stylist restituiti dagli slot.

Il problema: la dropdown "Operatore" (riga 196-202) usa `stylists` prop per popolarsi, non i risultati dell'API slots. Dobbiamo creare una lista filtrata.

Aggiungere dopo `const [newServiceId, setNewServiceId] = useState('');`:

```typescript
const [filteredStylists, setFilteredStylists] = useState<Pick<User, 'id' | 'full_name'>[]>([]);
```

- [ ] **Step 2: Caricare stylist filtrati quando cambia servizio**

Aggiungere un useEffect dopo quello degli slot (riga 44-50):

```typescript
// Filter stylists by selected service
useEffect(() => {
  if (!salonId || !form.service_id) {
    setFilteredStylists(stylists);
    return;
  }
  fetch(`/api/stylist-services?salon_id=${salonId}&stylist_id=_any&service_id=${form.service_id}`)
    .then(r => r.json())
    .then(ids => {
      if (!Array.isArray(ids) || ids.length === 0) {
        setFilteredStylists(stylists); // all available
      } else {
        setFilteredStylists(stylists.filter(s => ids.includes(s.id)));
      }
    })
    .catch(() => setFilteredStylists(stylists));
}, [salonId, form.service_id, stylists]);
```

Hmm, but the API doesn't support `stylist_id=_any&service_id=X` — it only supports `stylist_id=Y` returning services for that stylist. I need a different endpoint.

Actually, let me rethink. The simplest approach: add a new query parameter to the API.

Modificare `GET /api/stylist-services` in Task 2 per supportare un nuovo parametro `service_id` che restituisce tutti gli `stylist_id` assegnati a quel servizio.

Aggiorniamo Task 2 prima. Torniamo indietro...

Actually, let me just update the API in this task. È più semplice.

- [ ] **Step 1: Aggiornare l'API per supportare `service_id`**

In `src/app/api/stylist-services/route.ts`, modificare il GET handler:

```typescript
/** GET /api/stylist-services?salon_id=X&stylist_id=Y — stylist's services
 *  GET /api/stylist-services?salon_id=X&service_id=Y — service's stylists */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const stylist_id = searchParams.get('stylist_id');
  const service_id = searchParams.get('service_id');

  if (!salon_id) {
    return Response.json({ error: 'salon_id required' }, { status: 400 });
  }

  const supabase = await createServerSupabase();

  if (stylist_id) {
    const { data, error } = await supabase
      .from('stylist_services')
      .select('service_id')
      .eq('stylist_id', stylist_id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data.map((r: { service_id: string }) => r.service_id));
  }

  if (service_id) {
    const { data, error } = await supabase
      .from('stylist_services')
      .select('stylist_id')
      .eq('service_id', service_id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data.map((r: { stylist_id: string }) => r.stylist_id));
  }

  return Response.json({ error: 'stylist_id or service_id required' }, { status: 400 });
}
```

- [ ] **Step 2: Usare stylist filtrati nella dropdown operatore**

In `AppointmentModal.tsx`, sostituire la dropdown operatore (riga 196-202):

```tsx
<select className={`w-full border rounded-lg px-3 py-2 mt-1 text-sm ${errors.stylist ? 'border-red-400' : ''}`}
  value={form.stylist_id || ''}
  onChange={e => { setForm(f => ({ ...f, stylist_id: e.target.value, start_time: '' })); clearError('stylist'); }}>
  <option value="">Seleziona operatore...</option>
  {filteredStylists.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
</select>
```

E aggiungere il caricamento dei filteredStylists:

```typescript
// Load filtered stylists when service changes
useEffect(() => {
  if (!salonId || !form.service_id) {
    setFilteredStylists(stylists);
    return;
  }
  const controller = new AbortController();
  fetch(`/api/stylist-services?salon_id=${salonId}&service_id=${form.service_id}`, { signal: controller.signal })
    .then(r => r.json())
    .then(ids => {
      if (!Array.isArray(ids) || ids.length === 0) {
        // No assignments at all or no one assigned to this service -> all stylists
        setFilteredStylists(stylists);
      } else {
        setFilteredStylists(stylists.filter(s => ids.includes(s.id)));
      }
    })
    .catch(() => setFilteredStylists(stylists));
  return () => controller.abort();
}, [salonId, form.service_id, stylists]);

// Reset stylist if no longer valid for selected service
useEffect(() => {
  if (form.stylist_id && filteredStylists.length > 0 &&
      !filteredStylists.find(s => s.id === form.stylist_id)) {
    setForm(f => ({ ...f, stylist_id: '', start_time: '' }));
  }
}, [filteredStylists, form.stylist_id]);
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/stylist-services/route.ts src/app/(dashboard)/calendar/components/AppointmentModal.tsx
git commit -m "feat: dropdown operatore filtrata per servizio nella modale"
```

---

### Task 7: Widget pubblico — già filtrato dalle API

Nessuna modifica necessaria. L'API `/api/slots` ora chiama `fetchStylists(salon_id, stylist_id, service_id)` che filtra automaticamente. Il widget already riceve solo gli slot degli stylist abilitati.

- [ ] **Step 1: Commit vuoto per documentare**

```bash
git commit --allow-empty -m "feat: widget prenotazione filtra stylist via API slots (nessuna modifica UI necessaria)"
```

---

### Task 8: Verifica TypeScript e build

- [ ] **Step 1: Type check**

```bash
npx tsc --noEmit
```
Expected: zero errori.

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: build completata con successo.

- [ ] **Step 3: Commit finale**

```bash
git add -A
git commit -m "chore: verifica build dopo stylist-services"
```

---

### Task 9: Deploy e migration su produzione

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Deploy**

```bash
bash scripts/deploy.sh
```

- [ ] **Step 3: Migration DB**

```bash
ssh -i ~/.ssh/hetzner_deploy_key root@178.104.235.228 "cd /opt/gestionale-parrucchiere && export \$(grep DATABASE_URL .env.production | xargs) && psql \"\$DATABASE_URL\" -f supabase/migrations/007_stylist_services.sql"
```
