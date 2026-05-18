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

-- RLS
ALTER TABLE salons ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES
-- Users can read their own row (avoid self-referential RLS loop)
CREATE POLICY "Users read own row" ON users FOR SELECT
  USING (id = auth.uid());

-- SECURITY DEFINER function to safely get user's salon_id (avoids RLS recursion)
CREATE OR REPLACE FUNCTION get_user_salon_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT salon_id FROM public.users WHERE id = auth.uid()
$$;

-- Users can read other users in same salon
CREATE POLICY "Users read salon mates" ON users FOR SELECT
  USING (salon_id = get_user_salon_id());

CREATE POLICY "Users read own salon" ON salons FOR SELECT
  USING (id = get_user_salon_id());

CREATE POLICY "Services read salon" ON services FOR SELECT
  USING (salon_id IN get_user_salon_id());
CREATE POLICY "Services write admin" ON services FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = services.salon_id AND role IN ('owner', 'admin')));
CREATE POLICY "Services update admin" ON services FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = services.salon_id AND role IN ('owner', 'admin')));
CREATE POLICY "Services delete admin" ON services FOR DELETE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = services.salon_id AND role IN ('owner', 'admin')));

CREATE POLICY "Clients read salon" ON clients FOR SELECT
  USING (salon_id IN get_user_salon_id());
CREATE POLICY "Clients write staff" ON clients FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = clients.salon_id AND role IN ('owner', 'admin', 'receptionist')));
CREATE POLICY "Clients update staff" ON clients FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = clients.salon_id AND role IN ('owner', 'admin', 'receptionist')));

CREATE POLICY "Appointments read salon" ON appointments FOR SELECT
  USING (salon_id IN get_user_salon_id());
CREATE POLICY "Appointments write staff" ON appointments FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = appointments.salon_id AND role IN ('owner', 'admin', 'receptionist')));
CREATE POLICY "Appointments update staff" ON appointments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = appointments.salon_id AND role IN ('owner', 'admin', 'receptionist')));

CREATE POLICY "Time blocks read salon" ON time_blocks FOR SELECT
  USING (salon_id IN get_user_salon_id());
CREATE POLICY "Time blocks write admin" ON time_blocks FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = time_blocks.salon_id AND role IN ('owner', 'admin')));
CREATE POLICY "Time blocks update admin" ON time_blocks FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = time_blocks.salon_id AND role IN ('owner', 'admin')));
CREATE POLICY "Time blocks delete admin" ON time_blocks FOR DELETE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = time_blocks.salon_id AND role IN ('owner', 'admin')));

CREATE POLICY "Sync log read admin" ON sync_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND salon_id = sync_log.salon_id AND role IN ('owner', 'admin')));

-- Public access for booking widget
CREATE POLICY "Public read services" ON services FOR SELECT
  USING (is_active = true);
CREATE POLICY "Public insert appointments" ON appointments FOR INSERT
  WITH CHECK (true);

-- FUNCTIONS & TRIGGERS
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

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users (id, email, role, full_name)
  VALUES (NEW.id, NEW.email, 'stylist', COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
