-- Migration 004: service phases, buffer time, stylist overrides, in-chair modifications

-- 1. Extend services with phase decomposition + buffer time
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS duration_application integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duration_processing integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duration_finishing integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS buffer_time_minutes integer DEFAULT 0;

COMMENT ON COLUMN public.services.duration_application IS 'Minuti attivi (taglio, colore applicato) — lo stylist è occupato';
COMMENT ON COLUMN public.services.duration_processing IS 'Minuti di posa — lo stylist è libero per altri clienti';
COMMENT ON COLUMN public.services.duration_finishing IS 'Minuti finali (piega, finish) — lo stylist è occupato';
COMMENT ON COLUMN public.services.buffer_time_minutes IS 'Tempo pulizia post-appuntamento, invisibile al cliente';

-- 2. Stylist-specific duration overrides
CREATE TABLE IF NOT EXISTS public.service_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  stylist_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  duration_application integer,
  duration_processing integer,
  duration_finishing integer,
  buffer_time_minutes integer,
  UNIQUE(service_id, stylist_id)
);

ALTER TABLE public.service_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Overrides read salon" ON public.service_overrides FOR SELECT
  USING (salon_id = get_user_salon_id());
CREATE POLICY "Overrides write admin" ON public.service_overrides FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = service_overrides.salon_id AND role IN ('owner', 'admin')));
CREATE POLICY "Overrides update admin" ON public.service_overrides FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = service_overrides.salon_id AND role IN ('owner', 'admin')));
CREATE POLICY "Overrides delete admin" ON public.service_overrides FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = service_overrides.salon_id AND role IN ('owner', 'admin')));

-- 3. Appointments: buffer_end_time for internal stylist blocking + in-chair upselling
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS buffer_end_time timestamptz,
  ADD COLUMN IF NOT EXISTS added_services jsonb DEFAULT '[]';

COMMENT ON COLUMN public.appointments.buffer_end_time IS 'end_time + buffer — usato solo internamente per bloccare lo stylist';
COMMENT ON COLUMN public.appointments.added_services IS 'Servizi aggiunti in poltrona: [{service_id, name, duration_added, added_at}]';
