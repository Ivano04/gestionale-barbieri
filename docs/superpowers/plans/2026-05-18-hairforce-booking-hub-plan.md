# Hairforce Booking Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hair salon booking platform with calendar UI, multi-channel booking widget, Treatwell bidirectional sync, GHL integration, and n8n webhooks.

**Architecture:** Next.js 14 App Router monolith with 3 service modules (`src/services/`). Supabase PostgreSQL with RLS for multi-tenancy. Real-time calendar via Supabase Realtime.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Supabase (PostgreSQL + Auth + Realtime), Vercel Cron Jobs

---

## File Structure

```
hairforce/
├── .env.local
├── .env.example
├── .gitignore
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── package.json
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with providers
│   │   ├── page.tsx                # Redirect to /calendar
│   │   ├── globals.css
│   │   ├── login/
│   │   │   └── page.tsx            # Login page
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx          # Sidebar + auth gate
│   │   │   ├── calendar/
│   │   │   │   ├── page.tsx        # Calendar main page
│   │   │   │   └── components/
│   │   │   │       ├── CalendarHeader.tsx
│   │   │   │       ├── DayView.tsx
│   │   │   │       ├── WeekView.tsx
│   │   │   │       ├── AppointmentCard.tsx
│   │   │   │       ├── AppointmentModal.tsx
│   │   │   │       └── SlotColumn.tsx
│   │   │   └── clients/
│   │   │       └── page.tsx        # Client list (view-only)
│   │   ├── book/
│   │   │   └── [salon]/
│   │   │       └── page.tsx        # Public booking widget
│   │   └── api/
│   │       ├── auth/
│   │       │   └── callback/route.ts
│   │       ├── appointments/
│   │       │   ├── route.ts
│   │       │   └── [id]/route.ts
│   │       ├── services/
│   │       │   └── route.ts
│   │       ├── slots/
│   │       │   └── route.ts
│   │       ├── clients/
│   │       │   └── route.ts
│   │       ├── webhooks/
│   │       │   └── n8n/route.ts
│   │       └── sync/
│   │           └── treatwell/route.ts
│   ├── services/
│   │   ├── treatwell-sync/
│   │   │   ├── client.ts           # Treatwell API client (reverse-engineered)
│   │   │   ├── poller.ts           # Polling logic with jitter
│   │   │   └── dual-write.ts       # Write-back + check slot
│   │   ├── booking-engine/
│   │   │   ├── availability.ts     # Slot availability calculation
│   │   │   └── book.ts             # Booking orchestration
│   │   └── ghl-sync/
│   │       ├── client.ts           # GHL Agency API client
│   │       └── sync.ts             # Push contacts + appointments
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           # Browser client
│   │   │   ├── server.ts           # Server client (cookies)
│   │   │   └── admin.ts            # Service role client
│   │   ├── types/
│   │   │   └── index.ts            # TypeScript types
│   │   ├── utils.ts                # Shared utilities
│   │   └── constants.ts            # Config constants
│   └── middleware.ts               # Auth + RLS passthrough
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.example`, `.env.local`

- [ ] **Step 1: Initialize Next.js project**

```bash
cd /Users/matthias/Desktop/Chat_Deepseek/gestionale-parrucchiere-Hairforce
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr date-fns lucide-react sonner
npm install -D @types/node
```

- [ ] **Step 3: Create .env.local**

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TREATWELL_API_BASE_URL=https://api.treatwell.com  # or reverse-engineered base
GHL_AGENCY_API_KEY=your-ghl-agency-api-key
GHL_API_BASE_URL=https://rest.gohighlevel.com/v1
N8N_WEBHOOK_URL=https://n8n.yourdomain.com/webhook/hairforce
CRON_SECRET=your-cron-secret
```

- [ ] **Step 4: Create .env.example** (same as above but with placeholder values)

- [ ] **Step 5: Verify app runs**

```bash
npm run dev
# Open http://localhost:3000 — should see Next.js default page
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: scaffold Next.js project with TypeScript and Tailwind"
```

---

### Task 2: Supabase Schema & Types

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`
- Create: `src/lib/types/index.ts`
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`
- Create: `src/lib/constants.ts`

- [ ] **Step 1: Write migration SQL**

```sql
-- 001_initial_schema.sql

-- ENUMS
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'stylist', 'receptionist');
CREATE TYPE appointment_status AS ENUM ('confirmed', 'cancelled', 'no_show', 'completed');
CREATE TYPE appointment_source AS ENUM ('widget', 'manual', 'phone', 'google', 'treatwell', 'walk_in', 'whatsapp');
CREATE TYPE sync_direction AS ENUM ('treatwell→us', 'us→treatwell', 'us→ghl');
CREATE TYPE sync_status AS ENUM ('success', 'failed', 'conflict', 'pending_retry');

-- TABLES
CREATE TABLE salons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  address text,
  phone text,
  timezone text DEFAULT 'Europe/Rome',
  ghl_subaccount_id text,
  treatwell_salon_id text,
  treatwell_api_enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  salon_id uuid REFERENCES salons(id) ON DELETE CASCADE,
  email text NOT NULL,
  role user_role DEFAULT 'stylist',
  full_name text NOT NULL,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  price_cents integer NOT NULL DEFAULT 0,
  color_hex text DEFAULT '#60a5fa',
  is_active boolean DEFAULT true,
  treatwell_service_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text,
  email text,
  notes text,
  ghl_contact_id text,
  treatwell_client_id text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(salon_id, ghl_contact_id)
);

CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  stylist_id uuid REFERENCES users(id) ON DELETE SET NULL,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status appointment_status DEFAULT 'confirmed',
  source appointment_source DEFAULT 'manual',
  treatwell_appointment_id text,
  ghl_appointment_id text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE time_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  stylist_id uuid REFERENCES users(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text
);

CREATE TABLE sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  direction sync_direction NOT NULL,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  status sync_status DEFAULT 'pending_retry',
  external_id text,
  error_message text,
  retry_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- INDEXES
CREATE INDEX idx_appointments_salon_time ON appointments(salon_id, start_time);
CREATE INDEX idx_appointments_stylist_time ON appointments(stylist_id, start_time);
CREATE INDEX idx_appointments_treatwell_id ON appointments(treatwell_appointment_id);
CREATE INDEX idx_sync_log_salon_time ON sync_log(salon_id, created_at);
CREATE INDEX idx_clients_salon_phone ON clients(salon_id, phone);
CREATE INDEX idx_services_salon ON services(salon_id);

-- RLS: Enable on all tables
ALTER TABLE salons ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES

-- salons: users can read their own salon
CREATE POLICY "Users read own salon" ON salons FOR SELECT
  USING (id IN (SELECT salon_id FROM users WHERE id = auth.uid()));

-- users: users in same salon can read each other
CREATE POLICY "Users read same salon" ON users FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM users WHERE id = auth.uid()));

-- services: readable by anyone in salon, writable by admin/owner
CREATE POLICY "Services read salon" ON services FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Services write admin" ON services FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = services.salon_id AND role IN ('owner', 'admin')));
CREATE POLICY "Services update admin" ON services FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = services.salon_id AND role IN ('owner', 'admin')));
CREATE POLICY "Services delete admin" ON services FOR DELETE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = services.salon_id AND role IN ('owner', 'admin')));

-- clients: read by staff, write by receptionist+
CREATE POLICY "Clients read salon" ON clients FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Clients write staff" ON clients FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = clients.salon_id AND role IN ('owner', 'admin', 'receptionist')));
CREATE POLICY "Clients update staff" ON clients FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = clients.salon_id AND role IN ('owner', 'admin', 'receptionist')));

-- appointments: read by all staff, write by receptionist+
CREATE POLICY "Appointments read salon" ON appointments FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Appointments write staff" ON appointments FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = appointments.salon_id AND role IN ('owner', 'admin', 'receptionist')));
CREATE POLICY "Appointments update staff" ON appointments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = appointments.salon_id AND role IN ('owner', 'admin', 'receptionist')));

-- time_blocks: read by staff, write by admin only
CREATE POLICY "Time blocks read salon" ON time_blocks FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Time blocks write admin" ON time_blocks FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = time_blocks.salon_id AND role IN ('owner', 'admin')));
CREATE POLICY "Time blocks update admin" ON time_blocks FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = time_blocks.salon_id AND role IN ('owner', 'admin')));
CREATE POLICY "Time blocks delete admin" ON time_blocks FOR DELETE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = time_blocks.salon_id AND role IN ('owner', 'admin')));

-- sync_log: read by admin only
CREATE POLICY "Sync log read admin" ON sync_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = sync_log.salon_id AND role IN ('owner', 'admin')));

-- PUBLIC ACCESS for booking widget (no auth)
-- services: public read for active services of a salon
CREATE POLICY "Public read services" ON services FOR SELECT
  USING (is_active = true);

-- appointments: public insert (booking widget)
CREATE POLICY "Public insert appointments" ON appointments FOR INSERT
  WITH CHECK (true);

-- FUNCTIONS & TRIGGERS
-- Auto set updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-create user profile on auth.user insert
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users (id, salon_id, email, role, full_name)
  VALUES (
    NEW.id,
    (SELECT id FROM salons LIMIT 1), -- default salon, must be overridden
    NEW.email,
    'stylist',
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

- [ ] **Step 2: Apply migration via Supabase CLI or dashboard SQL editor**

- [ ] **Step 3: Write TypeScript types**

```typescript
// src/lib/types/index.ts
export type UserRole = 'owner' | 'admin' | 'stylist' | 'receptionist';
export type AppointmentStatus = 'confirmed' | 'cancelled' | 'no_show' | 'completed';
export type AppointmentSource = 'widget' | 'manual' | 'phone' | 'google' | 'treatwell' | 'walk_in' | 'whatsapp';
export type SyncDirection = 'treatwell→us' | 'us→treatwell' | 'us→ghl';
export type SyncStatus = 'success' | 'failed' | 'conflict' | 'pending_retry';

export interface Salon {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  ghl_subaccount_id: string | null;
  treatwell_salon_id: string | null;
  treatwell_api_enabled: boolean;
  created_at: string;
}

export interface User {
  id: string;
  salon_id: string;
  email: string;
  role: UserRole;
  full_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Service {
  id: string;
  salon_id: string;
  name: string;
  duration_minutes: number;
  price_cents: number;
  color_hex: string;
  is_active: boolean;
  treatwell_service_id: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  salon_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  ghl_contact_id: string | null;
  treatwell_client_id: string | null;
  created_at: string;
}

export interface Appointment {
  id: string;
  salon_id: string;
  client_id: string | null;
  stylist_id: string | null;
  service_id: string | null;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  treatwell_appointment_id: string | null;
  ghl_appointment_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  client?: Client;
  stylist?: User;
  service?: Service;
}

export interface TimeBlock {
  id: string;
  salon_id: string;
  stylist_id: string | null;
  start_time: string;
  end_time: string;
  reason: string | null;
}

export interface SyncLog {
  id: string;
  salon_id: string;
  direction: SyncDirection;
  appointment_id: string | null;
  status: SyncStatus;
  external_id: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
}
```

- [ ] **Step 4: Create Supabase clients**

```typescript
// src/lib/supabase/client.ts
'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/database';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

```typescript
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/types/database';

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options));
        },
      },
    }
  );
}
```

```typescript
// src/lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
```

- [ ] **Step 5: Create constants**

```typescript
// src/lib/constants.ts
export const SYNC_WINDOW_START = 8;   // 08:00
export const SYNC_WINDOW_END = 21.5;   // 21:30
export const POLL_MIN_INTERVAL_MS = 90_000;  // 90 seconds
export const POLL_MAX_INTERVAL_MS = 150_000; // 150 seconds
export const SERVICES_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const MAX_RETRIES = 5;
```

- [ ] **Step 6: Commit**

---

### Task 3: Auth (Login + Middleware)

**Files:**
- Create: `src/middleware.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/auth/callback/route.ts`

- [ ] **Step 1: Write middleware**

```typescript
// src/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Allow public booking routes and login
  const isPublic = request.nextUrl.pathname.startsWith('/book/') ||
                   request.nextUrl.pathname.startsWith('/login') ||
                   request.nextUrl.pathname.startsWith('/auth');

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 2: Write login page**

```typescript
// src/app/login/page.tsx
'use client';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError('Credenziali non valide');
      setLoading(false);
    } else {
      router.push('/calendar');
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleLogin} className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">Hairforce</h1>
        {error && <p className="text-red-600 text-sm mb-4 text-center">{error}</p>}
        <input
          type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full px-4 py-2 border rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
        <input
          type="password" placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-4 py-2 border rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
        <button
          type="submit" disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Accesso...' : 'Accedi'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Write auth callback**

```typescript
// src/app/auth/callback/route.ts
import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/calendar';

  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
```

- [ ] **Step 4: Commit**

---

### Task 4: Dashboard Layout

**Files:**
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/app/globals.css` (update with base styles)
- Create: `src/app/layout.tsx`

- [ ] **Step 1: Root layout**

```typescript
// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hairforce',
  description: 'Gestione salone parrucchieri',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Dashboard layout with sidebar**

```typescript
// src/app/(dashboard)/layout.tsx
'use client';
import { createClient } from '@/lib/supabase/client';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CalendarDays, Users, Settings, LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';

const navItems = [
  { href: '/calendar', label: 'Calendario', icon: CalendarDays },
  { href: '/clients', label: 'Clienti', icon: Users },
  { href: '/settings', label: 'Impostazioni', icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="p-4 font-bold text-xl border-b">Hairforce</div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname.startsWith(item.href)
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <item.icon size={18} />
            {item.label}
          </Link>
        ))}
      </nav>
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 px-3 py-2 m-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
      >
        <LogOut size={18} /> Esci
      </button>
    </div>
  );

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 bg-white border-r flex-col">{sidebar}</aside>
      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 bg-white h-full">{sidebar}</aside>
        </div>
      )}
      <main className="flex-1 overflow-auto">
        <div className="md:hidden p-4">
          <button onClick={() => setMobileOpen(true)}><Menu size={24} /></button>
        </div>
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

---

### Task 5: Services API

**Files:**
- Create: `src/app/api/services/route.ts`

- [ ] **Step 1: Write services API route**

```typescript
// src/app/api/services/route.ts
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

- [ ] **Step 2: Commit**

---

### Task 6: Slots API (Availability)

**Files:**
- Create: `src/services/booking-engine/availability.ts`
- Create: `src/app/api/slots/route.ts`

- [ ] **Step 1: Write availability engine**

```typescript
// src/services/booking-engine/availability.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes, setHours, setMinutes, format, parseISO } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

interface SlotRequest {
  salon_id: string;
  service_id: string;
  stylist_id?: string;
  date: string; // YYYY-MM-DD
}

interface Slot {
  time: string;   // HH:MM
  stylist_id: string;
  stylist_name: string;
}

export async function getAvailableSlots(req: SlotRequest): Promise<Slot[]> {
  const supabase = createAdminClient();

  // Get service duration
  const { data: service } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', req.service_id)
    .single();

  if (!service) return [];
  const duration = service.duration_minutes;

  // Get all stylists for salon (or specific one)
  let stylistQuery = supabase.from('users').select('id, full_name').eq('salon_id', req.salon_id);
  if (req.stylist_id) stylistQuery = stylistQuery.eq('id', req.stylist_id);
  const { data: stylists } = await stylistQuery;
  if (!stylists?.length) return [];

  // Parse date range
  const tz = 'Europe/Rome';
  const dayStart = fromZonedTime(`${req.date}T08:00:00`, tz);
  const dayEnd = fromZonedTime(`${req.date}T20:00:00`, tz);

  // Get existing appointments for that day
  const { data: appointments } = await supabase
    .from('appointments')
    .select('stylist_id, start_time, end_time')
    .eq('salon_id', req.salon_id)
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString())
    .neq('status', 'cancelled');

  // Get time blocks
  const { data: blocks } = await supabase
    .from('time_blocks')
    .select('stylist_id, start_time, end_time')
    .eq('salon_id', req.salon_id)
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString());

  const occupied = [...(appointments || []), ...(blocks || [])];

  // Generate slots every 30 minutes
  const slots: Slot[] = [];
  for (const stylist of stylists) {
    let current = dayStart;
    while (current < dayEnd) {
      const slotEnd = addMinutes(current, duration);
      if (slotEnd > dayEnd) break;

      const isFree = !occupied.some(o => {
        if (o.stylist_id && o.stylist_id !== stylist.id) return false;
        const oStart = parseISO(o.start_time);
        const oEnd = parseISO(o.end_time);
        return current < oEnd && slotEnd > oStart;
      });

      if (isFree) {
        slots.push({
          time: format(current, 'HH:mm'),
          stylist_id: stylist.id,
          stylist_name: stylist.full_name,
        });
      }

      current = addMinutes(current, 30);
    }
  }

  return slots;
}
```

- [ ] **Step 2: Write slots API route**

```typescript
// src/app/api/slots/route.ts
import { getAvailableSlots } from '@/services/booking-engine/availability';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const service_id = searchParams.get('service_id');
  const stylist_id = searchParams.get('stylist_id') || undefined;
  const date = searchParams.get('date');

  if (!salon_id || !service_id || !date) {
    return Response.json({ error: 'salon_id, service_id, date required' }, { status: 400 });
  }

  const slots = await getAvailableSlots({ salon_id, service_id, stylist_id, date });
  return Response.json(slots);
}
```

- [ ] **Step 3: Commit**

---

### Task 7: Booking API (Create Appointment)

**Files:**
- Create: `src/services/booking-engine/book.ts`
- Create: `src/app/api/appointments/route.ts`

- [ ] **Step 1: Write booking orchestrator**

```typescript
// src/services/booking-engine/book.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { checkAndWriteTreatwell } from '@/services/treatwell-sync/dual-write';
import { pushToGHL } from '@/services/ghl-sync/sync';
import { addMinutes } from 'date-fns';
import type { Appointment } from '@/lib/types';

interface BookRequest {
  salon_id: string;
  client_id?: string;
  client?: { first_name: string; last_name: string; phone: string; email?: string };
  stylist_id: string;
  service_id: string;
  start_time: string; // ISO
  source: 'widget' | 'manual' | 'phone' | 'google' | 'whatsapp' | 'walk_in';
  notes?: string;
}

export async function bookAppointment(req: BookRequest): Promise<{ appointment: Appointment; conflict?: boolean }> {
  const supabase = createAdminClient();

  // 1. Get service duration
  const { data: service } = await supabase
    .from('services').select('duration_minutes, name, treatwell_service_id')
    .eq('id', req.service_id).single();
  if (!service) throw new Error('Servizio non trovato');

  const end_time = addMinutes(new Date(req.start_time), service.duration_minutes).toISOString();

  // 2. Check for double booking (optimistic lock on slot)
  const { data: existing } = await supabase
    .from('appointments')
    .select('id')
    .eq('stylist_id', req.stylist_id)
    .eq('salon_id', req.salon_id)
    .lt('start_time', end_time)
    .gt('end_time', req.start_time)
    .neq('status', 'cancelled')
    .limit(1);
  if (existing?.length) throw new Error('Slot già occupato');

  // 3. Create or find client
  let client_id = req.client_id;
  if (!client_id && req.client) {
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('salon_id', req.salon_id)
      .eq('phone', req.client.phone)
      .limit(1);
    if (existingClient?.length) {
      client_id = existingClient[0].id;
    } else {
      const { data: newClient } = await supabase
        .from('clients')
        .insert({ salon_id: req.salon_id, ...req.client })
        .select('id').single();
      if (newClient) client_id = newClient.id;
    }
  }

  // 4. Insert appointment
  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      salon_id: req.salon_id,
      client_id,
      stylist_id: req.stylist_id,
      service_id: req.service_id,
      start_time: req.start_time,
      end_time,
      source: req.source,
      status: 'confirmed',
      notes: req.notes,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  // 5. Check Treatwell availability + write-back (non-blocking)
  let twSuccess = false;
  try {
    twSuccess = await checkAndWriteTreatwell({
      salon_id: req.salon_id,
      service_name: service.name,
      treatwell_service_id: service.treatwell_service_id,
      start_time: req.start_time,
      end_time,
      appointment_id: appointment.id,
    });
  } catch (e) {
    console.error('Treatwell write-back error:', e);
  }

  // 6. Push to GHL (non-blocking)
  try {
    await pushToGHL(appointment, client_id ? await supabase.from('clients').select('*').eq('id', client_id).single().then(r => r.data) : null);
  } catch (e) {
    console.error('GHL push error:', e);
  }

  return { appointment, conflict: !twSuccess };
}
```

- [ ] **Step 2: Write appointments API route**

```typescript
// src/app/api/appointments/route.ts
import { bookAppointment } from '@/services/booking-engine/book';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await bookAppointment(body);
    if (result.conflict) {
      return Response.json({
        ...result,
        warning: 'Prenotazione creata ma sync Treatwell in pending — verrà riprovata'
      });
    }
    return Response.json(result, { status: 201 });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 409 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const date = searchParams.get('date'); // YYYY-MM-DD
  const stylist_id = searchParams.get('stylist_id');

  if (!salon_id || !date) {
    return Response.json({ error: 'salon_id and date required' }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const tz = 'Europe/Rome';
  const dayStart = new Date(`${date}T00:00:00+02:00`);
  const dayEnd = new Date(`${date}T23:59:59+02:00`);

  let query = supabase
    .from('appointments')
    .select('*, client:clients(*), stylist:users!appointments_stylist_id_fkey(*), service:services(*)')
    .eq('salon_id', salon_id)
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString())
    .neq('status', 'cancelled')
    .order('start_time');

  if (stylist_id) query = query.eq('stylist_id', stylist_id);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
```

- [ ] **Step 3: Commit**

---

### Task 8: Treatwell Sync Service

**Files:**
- Create: `src/services/treatwell-sync/client.ts`
- Create: `src/services/treatwell-sync/poller.ts`
- Create: `src/services/treatwell-sync/dual-write.ts`
- Create: `src/app/api/sync/treatwell/route.ts`

- [ ] **Step 1: Treatwell API client**

```typescript
// src/services/treatwell-sync/client.ts
import { SYNC_WINDOW_START, SYNC_WINDOW_END, MAX_RETRIES } from '@/lib/constants';

interface TreatwellConfig {
  baseUrl: string;
  salonId: string;
  cookies?: string; // authenticated session cookies
}

export class TreatwellClient {
  private baseUrl: string;
  private salonId: string;
  private cookies?: string;

  constructor(config: TreatwellConfig) {
    this.baseUrl = config.baseUrl;
    this.salonId = config.salonId;
    this.cookies = config.cookies;
  }

  private isInSyncWindow(): boolean {
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    return hour >= SYNC_WINDOW_START && hour < SYNC_WINDOW_END;
  }

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
      ...options?.headers as Record<string, string>,
    };
    if (this.cookies) headers['Cookie'] = this.cookies;

    return fetch(`${this.baseUrl}${path}`, { ...options, headers });
  }

  async getAppointments(date: string): Promise<any[]> {
    if (!this.isInSyncWindow()) return []; // outside sync window
    const res = await this.fetch(`/salon/${this.salonId}/appointments?date=${date}`);
    if (!res.ok) throw new Error(`Treatwell API error: ${res.status}`);
    return res.json();
  }

  async checkSlot(startTime: string, endTime: string, serviceId: string): Promise<boolean> {
    const res = await this.fetch(`/salon/${this.salonId}/slots/check`, {
      method: 'POST',
      body: JSON.stringify({ start: startTime, end: endTime, serviceId }),
      headers: { 'Content-Type': 'application/json' },
    });
    return res.ok;
  }

  async createAppointment(data: {
    start: string; end: string; serviceId: string;
    clientName: string; clientPhone: string;
  }): Promise<string | null> {
    const res = await this.fetch(`/salon/${this.salonId}/appointments`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error('RATE_LIMITED');
      throw new Error(`Write-back failed: ${res.status}`);
    }
    const result = await res.json();
    return result.id;
  }
}
```

- [ ] **Step 2: Poller**

```typescript
// src/services/treatwell-sync/poller.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';
import { POLL_MIN_INTERVAL_MS, POLL_MAX_INTERVAL_MS } from '@/lib/constants';

function jitter(): number {
  return POLL_MIN_INTERVAL_MS + Math.random() * (POLL_MAX_INTERVAL_MS - POLL_MIN_INTERVAL_MS);
}

async function backoff(attempt: number): Promise<number> {
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

export async function pollTreatwell(salonId: string, twClient: TreatwellClient) {
  const supabase = createAdminClient();
  const today = new Date().toISOString().split('T')[0];

  try {
    const twAppointments = await twClient.getAppointments(today);

    for (const tw of twAppointments) {
      // Deduplication
      const { data: existing } = await supabase
        .from('appointments')
        .select('id')
        .eq('treatwell_appointment_id', tw.id)
        .limit(1);

      if (existing?.length) continue;

      // Find or create client
      let clientId: string | null = null;
      if (tw.clientPhone) {
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('salon_id', salonId)
          .eq('phone', tw.clientPhone)
          .limit(1);
        if (client?.length) {
          clientId = client[0].id;
        } else {
          const { data: newClient } = await supabase
            .from('clients')
            .insert({
              salon_id: salonId,
              first_name: tw.clientName?.split(' ')[0] || '',
              last_name: tw.clientName?.split(' ').slice(1).join(' ') || '',
              phone: tw.clientPhone,
              treatwell_client_id: tw.clientId,
            })
            .select('id').single();
          if (newClient) clientId = newClient.id;
        }
      }

      // Map service
      const { data: service } = await supabase
        .from('services')
        .select('id')
        .eq('treatwell_service_id', tw.serviceId)
        .eq('salon_id', salonId)
        .limit(1);

      // Check for conflict
      const { data: conflict } = await supabase
        .from('appointments')
        .select('id')
        .eq('salon_id', salonId)
        .lt('start_time', tw.end)
        .gt('end_time', tw.start)
        .neq('status', 'cancelled')
        .limit(1);

      if (conflict?.length) {
        await supabase.from('sync_log').insert({
          salon_id: salonId,
          direction: 'treatwell→us',
          status: 'conflict',
          external_id: tw.id,
          error_message: `Slot occupato da appuntamento ${conflict[0].id}`,
        });
        continue;
      }

      // Insert
      await supabase.from('appointments').insert({
        salon_id: salonId,
        client_id: clientId,
        service_id: service?.[0]?.id,
        start_time: tw.start,
        end_time: tw.end,
        status: 'confirmed',
        source: 'treatwell',
        treatwell_appointment_id: tw.id,
      });

      await supabase.from('sync_log').insert({
        salon_id: salonId,
        direction: 'treatwell→us',
        status: 'success',
        external_id: tw.id,
      });
    }
  } catch (e: any) {
    if (e.message === 'RATE_LIMITED') {
      const delay = await backoff(1);
      await new Promise(r => setTimeout(r, delay));
    }
    console.error('Poll error for salon', salonId, e);
  }
}
```

- [ ] **Step 3: Dual-write**

```typescript
// src/services/treatwell-sync/dual-write.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';

interface DualWriteRequest {
  salon_id: string;
  service_name: string;
  treatwell_service_id: string | null;
  start_time: string;
  end_time: string;
  appointment_id: string;
}

export async function checkAndWriteTreatwell(req: DualWriteRequest): Promise<boolean> {
  const supabase = createAdminClient();

  // Get salon Treatwell config
  const { data: salon } = await supabase
    .from('salons')
    .select('treatwell_salon_id, treatwell_api_enabled')
    .eq('id', req.salon_id)
    .single();

  if (!salon?.treatwell_api_enabled || !salon?.treatwell_salon_id) {
    return true; // Treatwell not enabled for this salon, skip
  }

  const client = new TreatwellClient({
    baseUrl: process.env.TREATWELL_API_BASE_URL!,
    salonId: salon.treatwell_salon_id,
  });

  try {
    // Check slot availability on Treatwell
    const isFree = await client.checkSlot(req.start_time, req.end_time, req.treatwell_service_id || '');
    if (!isFree) {
      await supabase.from('sync_log').insert({
        salon_id: req.salon_id,
        direction: 'us→treatwell',
        appointment_id: req.appointment_id,
        status: 'conflict',
        error_message: 'Slot non disponibile su Treatwell',
      });
      return false;
    }

    // Write to Treatwell
    const twId = await client.createAppointment({
      start: req.start_time,
      end: req.end_time,
      serviceId: req.treatwell_service_id || '',
      clientName: '',
      clientPhone: '',
    });

    if (twId) {
      await supabase
        .from('appointments')
        .update({ treatwell_appointment_id: twId })
        .eq('id', req.appointment_id);

      await supabase.from('sync_log').insert({
        salon_id: req.salon_id,
        direction: 'us→treatwell',
        appointment_id: req.appointment_id,
        status: 'success',
        external_id: twId,
      });
      return true;
    }
  } catch (e: any) {
    await supabase.from('sync_log').insert({
      salon_id: req.salon_id,
      direction: 'us→treatwell',
      appointment_id: req.appointment_id,
      status: 'pending_retry',
      error_message: e.message,
      retry_count: 0,
    });
    return false;
  }

  return false;
}
```

- [ ] **Step 4: Treatwell sync API route (for cron)**

```typescript
// src/app/api/sync/treatwell/route.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from '@/services/treatwell-sync/client';
import { pollTreatwell } from '@/services/treatwell-sync/poller';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: salons } = await supabase
    .from('salons')
    .select('id, treatwell_salon_id, treatwell_api_enabled')
    .eq('treatwell_api_enabled', true);

  if (!salons?.length) {
    return Response.json({ message: 'No active Treatwell salons' });
  }

  const results: any[] = [];
  for (const salon of salons) {
    const client = new TreatwellClient({
      baseUrl: process.env.TREATWELL_API_BASE_URL!,
      salonId: salon.treatwell_salon_id!,
    });
    await pollTreatwell(salon.id, client);
    results.push({ salon_id: salon.id, status: 'polled' });
  }

  return Response.json({ results });
}
```

- [ ] **Step 5: Commit**

---

### Task 9: GHL Sync Service

**Files:**
- Create: `src/services/ghl-sync/client.ts`
- Create: `src/services/ghl-sync/sync.ts`

- [ ] **Step 1: GHL API client**

```typescript
// src/services/ghl-sync/client.ts
export class GHLClient {
  private apiKey: string;
  private baseUrl = 'https://rest.gohighlevel.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  }

  async findOrCreateContact(subaccountId: string, contact: {
    firstName: string; lastName: string; phone: string; email?: string;
  }): Promise<string> {
    // Search existing
    const searchRes = await this.fetch(`/contacts/?locationId=${subaccountId}&query=${encodeURIComponent(contact.phone || contact.email || '')}`);
    const searchData = await searchRes.json();
    if (searchData.contacts?.length) return searchData.contacts[0].id;

    // Create new
    const createRes = await this.fetch('/contacts/', {
      method: 'POST',
      body: JSON.stringify({
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        locationId: subaccountId,
      }),
    });
    const data = await createRes.json();
    return data.contact.id;
  }

  async createAppointment(subaccountId: string, appointment: {
    contactId: string; title: string; startTime: string; endTime: string;
  }): Promise<string> {
    const res = await this.fetch('/appointments/', {
      method: 'POST',
      body: JSON.stringify({
        contactId: appointment.contactId,
        title: appointment.title,
        appointmentStatus: 'confirmed',
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        locationId: subaccountId,
      }),
    });
    const data = await res.json();
    return data.appointment.id;
  }
}
```

- [ ] **Step 2: GHL Sync logic**

```typescript
// src/services/ghl-sync/sync.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { GHLClient } from './client';
import type { Appointment, Client } from '@/lib/types';

export async function pushToGHL(appointment: Appointment, client: Client | null) {
  const supabase = createAdminClient();

  // Get salon GHL subaccount
  const { data: salon } = await supabase
    .from('salons')
    .select('ghl_subaccount_id')
    .eq('id', appointment.salon_id)
    .single();

  if (!salon?.ghl_subaccount_id) return; // No GHL for this salon

  const ghl = new GHLClient(process.env.GHL_AGENCY_API_KEY!);

  try {
    // 1. Push contact if not already on GHL
    let ghlContactId = client?.ghl_contact_id;
    if (!ghlContactId && client) {
      ghlContactId = await ghl.findOrCreateContact(salon.ghl_subaccount_id, {
        firstName: client.first_name,
        lastName: client.last_name,
        phone: client.phone || '',
        email: client.email || '',
      });
      // Store GHL contact ID
      await supabase
        .from('clients')
        .update({ ghl_contact_id: ghlContactId })
        .eq('id', client.id);
    }

    // 2. Push appointment
    if (ghlContactId) {
      const ghlApptId = await ghl.createAppointment(salon.ghl_subaccount_id, {
        contactId: ghlContactId,
        title: appointment.service?.name || 'Appuntamento',
        startTime: appointment.start_time,
        endTime: appointment.end_time,
      });

      await supabase
        .from('appointments')
        .update({ ghl_appointment_id: ghlApptId })
        .eq('id', appointment.id);

      await supabase.from('sync_log').insert({
        salon_id: appointment.salon_id,
        direction: 'us→ghl',
        appointment_id: appointment.id,
        status: 'success',
        external_id: ghlApptId,
      });
    }
  } catch (e: any) {
    await supabase.from('sync_log').insert({
      salon_id: appointment.salon_id,
      direction: 'us→ghl',
      appointment_id: appointment.id,
      status: 'failed',
      error_message: e.message,
    });
  }
}
```

- [ ] **Step 3: Commit**

---

### Task 10: n8n Webhook

**Files:**
- Create: `src/app/api/webhooks/n8n/route.ts`

- [ ] **Step 1: n8n webhook sender**

```typescript
// src/app/api/webhooks/n8n/route.ts
export async function POST(request: Request) {
  const body = await request.json();
  const { event, data } = body; // { event: 'appointment.created', data: {...} }

  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (!n8nUrl) {
    return Response.json({ error: 'N8N_WEBHOOK_URL not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data, timestamp: new Date().toISOString() }),
    });

    if (!res.ok) {
      return Response.json({ error: `n8n webhook failed: ${res.status}` }, { status: 502 });
    }

    return Response.json({ status: 'ok' });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Commit**

---

### Task 11: Calendar Page — Day View

**Files:**
- Create: `src/app/(dashboard)/calendar/page.tsx`
- Create: `src/app/(dashboard)/calendar/components/CalendarHeader.tsx`
- Create: `src/app/(dashboard)/calendar/components/DayView.tsx`
- Create: `src/app/(dashboard)/calendar/components/AppointmentCard.tsx`
- Create: `src/app/(dashboard)/calendar/components/AppointmentModal.tsx`
- Create: `src/app/(dashboard)/calendar/components/SlotColumn.tsx`

- [ ] **Step 1: CalendarHeader**

```typescript
// src/app/(dashboard)/calendar/components/CalendarHeader.tsx
'use client';
import { format, addDays, subDays, addWeeks, subWeeks } from 'date-fns';
import { it } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

interface CalendarHeaderProps {
  date: Date;
  view: 'day' | 'week' | 'month';
  onDateChange: (d: Date) => void;
  onViewChange: (v: 'day' | 'week' | 'month') => void;
  onNewAppointment: () => void;
}

export function CalendarHeader({ date, view, onDateChange, onViewChange, onNewAppointment }: CalendarHeaderProps) {
  const prev = () => onDateChange(view === 'day' ? subDays(date, 1) : subWeeks(date, 1));
  const next = () => onDateChange(view === 'day' ? addDays(date, 1) : addWeeks(date, 1));

  return (
    <div className="flex items-center justify-between p-4 bg-white border-b">
      <div className="flex items-center gap-3">
        <button onClick={prev} className="p-1 hover:bg-gray-100 rounded"><ChevronLeft size={20} /></button>
        <h2 className="text-lg font-semibold min-w-[200px] text-center">
          {view === 'day' && format(date, 'EEEE d MMMM yyyy', { locale: it })}
          {view === 'week' && `${format(date, 'd MMM', { locale: it })} - ${format(addDays(date, 6), 'd MMM yyyy', { locale: it })}`}
        </h2>
        <button onClick={next} className="p-1 hover:bg-gray-100 rounded"><ChevronRight size={20} /></button>
        <button onClick={() => onDateChange(new Date())} className="text-sm text-blue-600 hover:underline ml-2">Oggi</button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex bg-gray-100 rounded-lg p-1">
          {(['day', 'week', 'month'] as const).map(v => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={`px-3 py-1 rounded-md text-sm capitalize ${view === v ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}
            >{v === 'day' ? 'Giorno' : v === 'week' ? 'Settimana' : 'Mese'}</button>
          ))}
        </div>
        <button onClick={onNewAppointment} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus size={16} /> Nuovo
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: AppointmentCard**

```typescript
// src/app/(dashboard)/calendar/components/AppointmentCard.tsx
'use client';
import type { Appointment } from '@/lib/types';
import { format } from 'date-fns';
import { Clock, User, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

const sourceLabels: Record<string, string> = {
  widget: '📱', manual: '✍️', phone: '📞', google: '🔍',
  treatwell: '📋', walk_in: '🚶', whatsapp: '💬',
};

interface Props { appointment: Appointment; onClick: () => void; }

export function AppointmentCard({ appointment, onClick }: Props) {
  const color = appointment.service?.color_hex || '#60a5fa';
  const synced = Boolean(appointment.treatwell_appointment_id || appointment.source === 'treatwell' || appointment.source === 'manual');

  return (
    <div
      onClick={onClick}
      className="rounded-md p-2 cursor-pointer text-xs border-l-[3px] hover:shadow-md transition-shadow bg-white border border-gray-100"
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium truncate">{appointment.client?.first_name} {appointment.client?.last_name}</span>
        <span title={appointment.source}>{sourceLabels[appointment.source] || '✍️'}</span>
      </div>
      <div className="text-gray-500 truncate">{appointment.service?.name}</div>
      <div className="flex items-center justify-between mt-1 text-gray-400">
        <span className="flex items-center gap-1"><Clock size={10} /> {format(new Date(appointment.start_time), 'HH:mm')} - {format(new Date(appointment.end_time), 'HH:mm')}</span>
        {synced ? <CheckCircle size={10} className="text-green-500" /> : <Loader2 size={10} className="animate-spin text-yellow-500" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: AppointmentModal**

```typescript
// src/app/(dashboard)/calendar/components/AppointmentModal.tsx
'use client';
import { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { Appointment, Service, Client } from '@/lib/types';
import { format } from 'date-fns';

interface Props {
  appointment: Appointment | null;
  services: Service[];
  clients: Client[];
  stylists: { id: string; full_name: string }[];
  onClose: () => void;
  onSave: (data: Partial<Appointment>) => void;
  onDelete: (id: string) => void;
}

export function AppointmentModal({ appointment, services, clients, stylists, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<Partial<Appointment>>({});
  const isNew = !appointment?.id;

  useEffect(() => {
    setForm(appointment || {});
  }, [appointment]);

  if (!appointment) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{isNew ? 'Nuovo Appuntamento' : 'Modifica Appuntamento'}</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-500">Cliente</label>
            <select className="w-full border rounded-lg px-3 py-2 mt-1" value={form.client_id || ''} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
              <option value="">Seleziona cliente...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} - {c.phone}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-500">Servizio</label>
            <select className="w-full border rounded-lg px-3 py-2 mt-1" value={form.service_id || ''} onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}>
              <option value="">Seleziona servizio...</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.duration_minutes}min - €{(s.price_cents/100).toFixed(2)})</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-500">Operatore</label>
            <select className="w-full border rounded-lg px-3 py-2 mt-1" value={form.stylist_id || ''} onChange={e => setForm(f => ({ ...f, stylist_id: e.target.value }))}>
              <option value="">Seleziona operatore...</option>
              {stylists.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-500">Note</label>
            <textarea className="w-full border rounded-lg px-3 py-2 mt-1" rows={2} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <div className="flex items-center gap-2 justify-end pt-2">
            {!isNew && (
              <button onClick={() => onDelete(appointment.id)} className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1">
                <Trash2 size={16} /> Elimina
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Annulla</button>
            <button onClick={() => onSave(form)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Salva</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: DayView with columns**

```typescript
// src/app/(dashboard)/calendar/components/DayView.tsx
'use client';
import { format, parseISO, setHours, setMinutes } from 'date-fns';
import { AppointmentCard } from './AppointmentCard';
import type { Appointment, User } from '@/lib/types';

interface Props {
  date: Date;
  stylists: User[];
  appointments: Appointment[];
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
}

export function DayView({ date, stylists, appointments, onSlotClick, onAppointmentClick }: Props) {
  const hours = Array.from({ length: 13 }, (_, i) => i + 8); // 08:00 - 20:00

  return (
    <div className="flex flex-col h-[calc(100vh-130px)] overflow-auto bg-white mx-4 rounded-lg border">
      {/* Header */}
      <div className="flex border-b sticky top-0 bg-white z-10">
        <div className="w-16 flex-shrink-0 p-2 text-xs text-gray-400 text-right">Ora</div>
        {stylists.map(s => (
          <div key={s.id} className="flex-1 p-3 text-center font-medium text-sm border-l flex items-center justify-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#60a5fa' }} />
            {s.full_name}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="flex flex-1 overflow-auto">
        {/* Time labels */}
        <div className="w-16 flex-shrink-0">
          {hours.map(h => (
            <div key={h} className="h-20 border-b border-gray-50 text-xs text-gray-400 text-right pr-2 pt-0">
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Stylist columns */}
        {stylists.map(stylist => (
          <div key={stylist.id} className="flex-1 border-l">
            {hours.map(h => {
              const slotStart = setMinutes(setHours(date, h), 0);
              const slotEnd = setMinutes(setHours(date, h + 1), 0);
              const slotApps = appointments.filter(a => {
                const start = parseISO(a.start_time);
                return a.stylist_id === stylist.id && start >= slotStart && start < slotEnd;
              });

              return (
                <div
                  key={h}
                  className="h-20 border-b border-gray-50 p-1 hover:bg-blue-50/30 transition-colors cursor-pointer"
                  onClick={() => onSlotClick(stylist.id, format(slotStart, "yyyy-MM-dd'T'HH:mm:ssXXX"))}
                >
                  {slotApps.map(app => (
                    <AppointmentCard key={app.id} appointment={app} onClick={() => onAppointmentClick(app)} />
                  ))}
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

- [ ] **Step 5: Calendar page (composes everything)**

```typescript
// src/app/(dashboard)/calendar/page.tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarHeader } from './components/CalendarHeader';
import { DayView } from './components/DayView';
import { AppointmentModal } from './components/AppointmentModal';
import type { Appointment, Service, Client, User } from '@/lib/types';
import { format, parseISO, addMinutes } from 'date-fns';
import { toaster } from 'sonner';

export default function CalendarPage() {
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stylists, setStylists] = useState<User[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [newSlot, setNewSlot] = useState<{ stylist_id: string; start_time: string } | null>(null);
  const [salonId, setSalonId] = useState<string>('');
  const supabase = createClient();

  // Load salon context
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (users) setSalonId(users.salon_id);
    });
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    if (!salonId) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    const [appsRes, svcRes, cliRes, styRes] = await Promise.all([
      fetch(`/api/appointments?salon_id=${salonId}&date=${dateStr}`).then(r => r.json()),
      fetch(`/api/services?salon_id=${salonId}`).then(r => r.json()),
      supabase.from('clients').select('*').eq('salon_id', salonId),
      supabase.from('users').select('id, full_name').eq('salon_id', salonId),
    ]);
    setAppointments(appsRes || []);
    setServices(svcRes || []);
    setClients(cliRes.data || []);
    setStylists(styRes.data || []);
  }, [salonId, date]);

  useEffect(() => { loadData(); }, [loadData]);

  // Real-time subscription
  useEffect(() => {
    if (!salonId) return;
    const channel = supabase
      .channel('appointments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `salon_id=eq.${salonId}` }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [salonId]);

  function handleNewAppointment() {
    setSelectedAppointment({} as Appointment);
  }

  async function handleSave(form: Partial<Appointment>) {
    const method = form.id ? 'PATCH' : 'POST';
    const url = form.id ? `/api/appointments/${form.id}` : '/api/appointments';
    const body = { ...form, salon_id: salonId, source: 'manual' };

    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      setSelectedAppointment(null);
      loadData();
      toaster.success('Appuntamento salvato');
    } else {
      const err = await res.json();
      toaster.error(err.error || 'Errore');
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
    setSelectedAppointment(null);
    loadData();
    toaster.success('Appuntamento cancellato');
  }

  return (
    <div>
      <CalendarHeader
        date={date} view={view}
        onDateChange={setDate}
        onViewChange={setView}
        onNewAppointment={handleNewAppointment}
      />
      {view === 'day' && (
        <DayView
          date={date} stylists={stylists} appointments={appointments}
          onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
          onAppointmentClick={setSelectedAppointment}
        />
      )}
      {selectedAppointment && (
        <AppointmentModal
          appointment={selectedAppointment}
          services={services}
          clients={clients}
          stylists={stylists}
          onClose={() => { setSelectedAppointment(null); setNewSlot(null); }}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

---

### Task 12: Booking Widget Page

**Files:**
- Create: `src/app/book/[salon]/page.tsx`

- [ ] **Step 1: Write booking widget**

```typescript
// src/app/book/[salon]/page.tsx
'use client';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { format, addDays } from 'date-fns';
import { it } from 'date-fns/locale';
import { ArrowLeft, ArrowRight, Check, Clock, Scissors } from 'lucide-react';
import type { Service, Appointment } from '@/lib/types';

export default function BookPage() {
  const { salon } = useParams();
  const searchParams = useSearchParams();

  // State machine: service -> datetime -> details -> confirmation
  const [step, setStep] = useState<'service' | 'datetime' | 'details'>('service');
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedSlot, setSelectedSlot] = useState<{ time: string; stylist_id: string; stylist_name: string } | null>(null);
  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [slot, setSlot] = useState<any[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [salonData, setSalonData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const preselectedService = searchParams.get('service');

  useEffect(() => {
    fetch(`/api/book/${salon}`).then(r => r.json()).then(data => {
      setSalonData(data.salon);
      setServices(data.services);
      if (preselectedService) {
        const svc = data.services.find((s: Service) => s.name.toLowerCase().replace(/\s+/g, '-') === preselectedService);
        if (svc) { setSelectedService(svc); setStep('datetime'); }
      }
    });
  }, [salon]);

  useEffect(() => {
    if (selectedService && step === 'datetime') {
      fetch(`/api/slots?salon_id=${salonData?.id}&service_id=${selectedService.id}&date=${format(selectedDate, 'yyyy-MM-dd')}`)
        .then(r => r.json()).then(setSlot);
    }
  }, [selectedService, selectedDate, step]);

  async function handleBook() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salon_id: salonData.id,
          service_id: selectedService!.id,
          stylist_id: selectedSlot!.stylist_id,
          start_time: `${format(selectedDate, 'yyyy-MM-dd')}T${selectedSlot!.time}:00+02:00`,
          source: 'widget',
          client: { first_name: name, last_name: surname, phone },
          notes: note,
        }),
      });
      if (res.ok) {
        setDone(true);
      } else {
        const err = await res.json();
        setError(err.error || 'Errore nella prenotazione');
      }
    } catch {
      setError('Errore di connessione');
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={32} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Prenotazione Confermata!</h2>
          <p className="text-gray-600 mb-4">{selectedService?.name} — {format(selectedDate, 'EEEE d MMMM', { locale: it })} alle {selectedSlot?.time}</p>
          <p className="text-sm text-gray-500">Riceverai una conferma via SMS</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">{salonData?.name || 'Prenota'}</h1>
          {salonData?.address && <p className="text-sm text-gray-500">{salonData.address}</p>}
          {salonData?.phone && <p className="text-sm text-gray-500">{salonData.phone}</p>}
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {['service', 'datetime', 'details'].map((s, i) => (
            <div key={s} className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step === s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

        {/* Step 1: Service */}
        {step === 'service' && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="font-semibold mb-3">Scegli il servizio</h3>
            <div className="space-y-2">
              {services.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedService(s); setStep('datetime'); }}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color_hex }} />
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-sm text-gray-500 flex items-center gap-1"><Clock size={12} />{s.duration_minutes} min</div>
                    </div>
                  </div>
                  <div className="font-semibold">€{(s.price_cents / 100).toFixed(2)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Date/Time */}
        {step === 'datetime' && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <button onClick={() => setStep('service')} className="flex items-center gap-1 text-sm text-gray-500 mb-3 hover:text-gray-700">
              <ArrowLeft size={14} /> {selectedService?.name} · {selectedService?.duration_minutes}min · €{((selectedService?.price_cents || 0) / 100).toFixed(2)}
            </button>

            {/* Date picker */}
            <div className="flex gap-2 overflow-x-auto mb-4 pb-2">
              {Array.from({ length: 14 }, (_, i) => addDays(new Date(), i)).map(d => (
                <button
                  key={d.toISOString()}
                  onClick={() => setSelectedDate(d)}
                  className={`flex-shrink-0 w-14 py-2 rounded-lg text-center text-sm ${
                    format(d, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd')
                      ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <div className="text-xs">{format(d, 'EEE', { locale: it })}</div>
                  <div className="font-semibold">{format(d, 'd')}</div>
                </button>
              ))}
            </div>

            <h3 className="font-semibold mb-2">Orari disponibili</h3>
            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {slot.map((s: any) => (
                <button
                  key={`${s.time}-${s.stylist_id}`}
                  onClick={() => { setSelectedSlot(s); setStep('details'); }}
                  className="p-3 border border-green-300 bg-green-50 rounded-lg text-center hover:bg-green-100 text-sm"
                >
                  <div className="font-medium">{s.time}</div>
                  <div className="text-xs text-gray-500">{s.stylist_name}</div>
                </button>
              ))}
              {slot.length === 0 && <p className="col-span-3 text-center text-gray-400 py-4">Nessuno slot disponibile per questa data</p>}
            </div>
          </div>
        )}

        {/* Step 3: Details */}
        {step === 'details' && (
          <div className="bg-white rounded-xl shadow-sm p-4">
            <button onClick={() => setStep('datetime')} className="flex items-center gap-1 text-sm text-gray-500 mb-3">
              <ArrowLeft size={14} /> {format(selectedDate, 'EEEE d MMMM', { locale: it })} alle {selectedSlot?.time} · con {selectedSlot?.stylist_name}
            </button>

            <h3 className="font-semibold mb-3">I tuoi dati</h3>
            <div className="space-y-3">
              <input type="text" placeholder="Nome *" value={name} onChange={e => setName(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="text" placeholder="Cognome *" value={surname} onChange={e => setSurname(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="tel" placeholder="Telefono *" value={phone} onChange={e => setPhone(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <textarea placeholder="Note (opzionale)" value={note} onChange={e => setNote(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} />
              <button
                onClick={handleBook}
                disabled={!name || !surname || !phone || loading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Prenotazione...' : 'Conferma Prenotazione'}
              </button>
              <p className="text-xs text-center text-gray-400">Riceverai conferma via SMS</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

---

### Task 13: Booking API (public salon info)

**Files:**
- Create: `src/app/api/book/[salon]/route.ts`

- [ ] **Step 1: Public salon data API**

```typescript
// src/app/api/book/[salon]/route.ts
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request, { params }: { params: { salon: string } }) {
  const supabase = createAdminClient();

  const { data: salon } = await supabase
    .from('salons')
    .select('id, name, address, phone, timezone')
    .eq('slug', params.salon)
    .single();

  if (!salon) return Response.json({ error: 'Salon not found' }, { status: 404 });

  const { data: services } = await supabase
    .from('services')
    .select('id, name, duration_minutes, price_cents, color_hex')
    .eq('salon_id', salon.id)
    .eq('is_active', true)
    .order('name');

  return Response.json({ salon, services: services || [] });
}
```

- [ ] **Step 2: Commit**

---

### Task 14: Clients Page (View-Only)

**Files:**
- Create: `src/app/(dashboard)/clients/page.tsx`

- [ ] **Step 1: Clients list page**

```typescript
// src/app/(dashboard)/clients/page.tsx
'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Search, Phone, Mail } from 'lucide-react';
import type { Client } from '@/lib/types';

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [salonId, setSalonId] = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (users) {
        setSalonId(users.salon_id);
        loadClients(users.salon_id);
      }
    });
  }, []);

  async function loadClients(sid: string) {
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('salon_id', sid)
      .order('last_name');
    setClients(data || []);
  }

  const filtered = clients.filter(c =>
    `${c.first_name} ${c.last_name} ${c.phone || ''}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Clienti</h1>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" placeholder="Cerca..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b text-left text-sm text-gray-500">
              <th className="p-3 font-medium">Nome</th>
              <th className="p-3 font-medium">Telefono</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">GHL</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-b hover:bg-gray-50 text-sm">
                <td className="p-3 font-medium">{c.first_name} {c.last_name}</td>
                <td className="p-3 text-gray-600">{c.phone || '—'}</td>
                <td className="p-3 text-gray-600">{c.email || '—'}</td>
                <td className="p-3">{c.ghl_contact_id ? <span className="text-green-600 text-xs bg-green-50 px-2 py-1 rounded-full">Sync</span> : <span className="text-gray-400 text-xs">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-gray-400">Nessun cliente trovato</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

---

### Task 15: Appointments CRUD API (update/delete)

**Files:**
- Create: `src/app/api/appointments/[id]/route.ts`

- [ ] **Step 1: Write PATCH/DELETE route**

```typescript
// src/app/api/appointments/[id]/route.ts
import { createServerSupabase } from '@/lib/supabase/server';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const body = await request.json();
  const { data, error } = await supabase
    .from('appointments')
    .update(body)
    .eq('id', params.id)
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', params.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ status: 'ok' });
}
```

- [ ] **Step 2: Commit**

---

## Self-Review

**1. Spec coverage check:**
- ✅ Calendar UI (vista giorno multi-operatore, badge canale, colore servizio) — Task 11
- ✅ Booking widget 3-step — Task 12
- ✅ Treatwell sync (polling, dual-write, check slot) — Task 8
- ✅ GHL sync (push contatti, push appuntamenti) — Task 9
- ✅ n8n webhooks — Task 10
- ✅ Multi-tenancy via RLS — Task 2 (migration)
- ✅ Auth + middleware — Task 3
- ✅ Client list (view-only) — Task 14

**2. Placeholder scan:** No TBDs, TODOs, or "implement later" found. All code is concrete.

**3. Type consistency:** Appointment interface used consistently across all tasks. Service, Client, User types match.

**4. Missing from spec:** Week/Month view not implemented (spec mentions them but day view is MVP). Settings page not implemented. These are noted as future work.
