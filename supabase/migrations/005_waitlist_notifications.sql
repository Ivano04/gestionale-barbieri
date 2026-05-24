-- Migration 005: waitlist + notifications

-- 1. Waitlist entries
CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  -- For new/non-registered clients
  first_name text,
  last_name text,
  phone text,
  -- What they want
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  stylist_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  preferred_date date NOT NULL,
  preferred_time_start time,
  preferred_time_end time,
  -- State machine
  status text DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'booked', 'expired', 'cancelled')),
  notified_at timestamptz,
  booked_appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  -- Time bounds
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '7 days')
);

CREATE INDEX idx_waitlist_salon_date ON public.waitlist_entries(salon_id, preferred_date);
CREATE INDEX idx_waitlist_status ON public.waitlist_entries(status) WHERE status = 'waiting';

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Waitlist read salon" ON public.waitlist_entries FOR SELECT
  USING (salon_id = get_user_salon_id());
CREATE POLICY "Waitlist write staff" ON public.waitlist_entries FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = waitlist_entries.salon_id AND role IN ('owner', 'admin', 'receptionist')));
CREATE POLICY "Waitlist update staff" ON public.waitlist_entries FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = waitlist_entries.salon_id AND role IN ('owner', 'admin', 'receptionist')));
-- Public insert (booking widget)
CREATE POLICY "Public insert waitlist" ON public.waitlist_entries FOR INSERT
  WITH CHECK (true);

-- 2. Notification preferences on clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS notification_preference text DEFAULT 'sms'
  CHECK (notification_preference IN ('sms', 'email', 'both', 'none'));

-- 3. Notification log
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  waitlist_entry_id uuid REFERENCES public.waitlist_entries(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  -- What was sent
  type text NOT NULL CHECK (type IN (
    'appointment_confirmed',
    'appointment_reminder',
    'appointment_cancelled',
    'appointment_updated',
    'waitlist_slot_available'
  )),
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  recipient text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_notifications_appointment ON public.notifications(appointment_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Notifications read salon" ON public.notifications FOR SELECT
  USING (salon_id = get_user_salon_id());
CREATE POLICY "Notifications write staff" ON public.notifications FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = notifications.salon_id AND role IN ('owner', 'admin', 'receptionist')));
