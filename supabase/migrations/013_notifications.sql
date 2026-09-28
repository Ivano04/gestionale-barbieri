-- Migration 013: tabella notifiche (email automatiche di fidelizzazione)
-- Traccia cosa e' stato inviato per ogni appuntamento, garantendo l'idempotenza
-- (niente doppioni) tramite UNIQUE(appointment_id, type).
-- Idempotente: rieseguibile in sicurezza. Scritture via service-role (webhook/cron),
-- quindi solo policy di lettura per i membri del salone.

BEGIN;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('confirmation', 'reminder', 'review')),
  status text NOT NULL DEFAULT 'sent',
  sent_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(appointment_id, type)
);

CREATE INDEX IF NOT EXISTS idx_notifications_salon ON public.notifications(salon_id);
CREATE INDEX IF NOT EXISTS idx_notifications_appt ON public.notifications(appointment_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notifications read salon" ON public.notifications;
CREATE POLICY "Notifications read salon" ON public.notifications FOR SELECT
  USING (salon_id = get_user_salon_id());

COMMIT;
