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
