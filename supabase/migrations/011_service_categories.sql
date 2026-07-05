-- Migration 011: categorie servizi con colori
CREATE TABLE IF NOT EXISTS public.service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  name text NOT NULL,
  color_hex text NOT NULL DEFAULT '#6b7280',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Categories read salon" ON public.service_categories FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid()
    AND salon_id = service_categories.salon_id
  ));

CREATE POLICY "Categories write salon" ON public.service_categories FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid()
    AND salon_id = service_categories.salon_id
    AND role IN ('owner', 'admin')
  ));

CREATE POLICY "Categories update salon" ON public.service_categories FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid()
    AND salon_id = service_categories.salon_id
    AND role IN ('owner', 'admin')
  ));

CREATE POLICY "Categories delete salon" ON public.service_categories FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid()
    AND salon_id = service_categories.salon_id
    AND role IN ('owner', 'admin')
  ));

-- Aggiungi category_id a services
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.service_categories(id) ON DELETE SET NULL;
