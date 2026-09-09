-- Migration 012: scheletro dati per pagamenti online + sistema fiscale (corrispettivi)
-- Solo schema, nessuna logica applicativa.
-- Crediti/pacchetti e preventivi rimandati a una migrazione successiva (fase dedicata).
--
-- Principi:
--   * Soldi sempre in centesimi (integer), mai float.
--   * Nessun segreto nel DB: le chiavi API stanno nelle env. Qui solo id non-segreti
--     (es. account Connect Stripe "acct_...").
--   * RLS come nel resto del progetto: lettura ai membri del salone; scrittura config a
--     owner/admin; payments e fiscal_documents scritti dai webhook via service-role
--     (che bypassa la RLS), quindi niente policy di INSERT/UPDATE lato utente.
--
-- IDEMPOTENTE: si puo' rieseguire in sicurezza. I tipi sono creati con guardie,
-- le policy/trigger vengono prima rimossi se esistenti. Tutto in una transazione:
-- se qualcosa fallisce, rollback totale e il database resta com'era.

BEGIN;

-- ENUMS (guardati: non falliscono se il tipo esiste gia')
DO $$ BEGIN CREATE TYPE payment_provider AS ENUM ('stripe', 'nexi'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE fiscal_provider AS ENUM ('fiskaly', 'acube', 'effatta'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE provider_mode AS ENUM ('test', 'live'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('pending', 'authorized', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'canceled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE fiscal_doc_type AS ENUM ('acconto', 'saldo', 'unico', 'storno'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE fiscal_doc_status AS ENUM ('pending', 'sent', 'confirmed', 'failed', 'canceled'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- TABLE: payment_configs (un record per salone/provider: instradamento dei pagamenti)
CREATE TABLE IF NOT EXISTS public.payment_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  provider payment_provider NOT NULL DEFAULT 'stripe',
  mode provider_mode NOT NULL DEFAULT 'test',
  stripe_account_id text,               -- account Connect del salone (acct_...), null per Nexi
  charges_enabled boolean NOT NULL DEFAULT false,   -- stato onboarding Connect
  payouts_enabled boolean NOT NULL DEFAULT false,   -- stato onboarding Connect
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(salon_id, provider)
);

-- TABLE: payments (ogni pagamento)
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  provider payment_provider NOT NULL,
  provider_payment_id text,             -- id PaymentIntent Stripe / codTrans Nexi
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  status payment_status NOT NULL DEFAULT 'pending',
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- TABLE: fiscal_configs (un record per salone: quale provider fiscale)
CREATE TABLE IF NOT EXISTS public.fiscal_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  provider fiscal_provider NOT NULL DEFAULT 'fiskaly',
  mode provider_mode NOT NULL DEFAULT 'test',
  external_ref text,                    -- es. id cassa/punto vendita lato provider
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(salon_id, provider)
);

-- TABLE: fiscal_documents (ogni corrispettivo emesso)
CREATE TABLE IF NOT EXISTS public.fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  provider fiscal_provider NOT NULL,
  doc_type fiscal_doc_type NOT NULL DEFAULT 'unico',
  protocol_id text,                     -- protocollo restituito dal provider/AdE
  amount_cents integer NOT NULL,
  status fiscal_doc_status NOT NULL DEFAULT 'pending',
  raw_response jsonb,                   -- risposta grezza del provider (debug)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_payment_configs_salon ON public.payment_configs(salon_id);
CREATE INDEX IF NOT EXISTS idx_payments_salon_time ON public.payments(salon_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_appointment ON public.payments(appointment_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_id ON public.payments(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_configs_salon ON public.fiscal_configs(salon_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_salon_time ON public.fiscal_documents(salon_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_payment ON public.fiscal_documents(payment_id);

-- RLS (abilitare e' idempotente)
ALTER TABLE public.payment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_documents ENABLE ROW LEVEL SECURITY;

-- payment_configs: lettura membri salone, scrittura owner/admin
DROP POLICY IF EXISTS "Payment configs read salon" ON public.payment_configs;
CREATE POLICY "Payment configs read salon" ON public.payment_configs FOR SELECT
  USING (salon_id = get_user_salon_id());
DROP POLICY IF EXISTS "Payment configs write admin" ON public.payment_configs;
CREATE POLICY "Payment configs write admin" ON public.payment_configs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = payment_configs.salon_id AND role IN ('owner', 'admin')));
DROP POLICY IF EXISTS "Payment configs update admin" ON public.payment_configs;
CREATE POLICY "Payment configs update admin" ON public.payment_configs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = payment_configs.salon_id AND role IN ('owner', 'admin')));
DROP POLICY IF EXISTS "Payment configs delete admin" ON public.payment_configs;
CREATE POLICY "Payment configs delete admin" ON public.payment_configs FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = payment_configs.salon_id AND role IN ('owner', 'admin')));

-- fiscal_configs: lettura membri salone, scrittura owner/admin
DROP POLICY IF EXISTS "Fiscal configs read salon" ON public.fiscal_configs;
CREATE POLICY "Fiscal configs read salon" ON public.fiscal_configs FOR SELECT
  USING (salon_id = get_user_salon_id());
DROP POLICY IF EXISTS "Fiscal configs write admin" ON public.fiscal_configs;
CREATE POLICY "Fiscal configs write admin" ON public.fiscal_configs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = fiscal_configs.salon_id AND role IN ('owner', 'admin')));
DROP POLICY IF EXISTS "Fiscal configs update admin" ON public.fiscal_configs;
CREATE POLICY "Fiscal configs update admin" ON public.fiscal_configs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = fiscal_configs.salon_id AND role IN ('owner', 'admin')));
DROP POLICY IF EXISTS "Fiscal configs delete admin" ON public.fiscal_configs;
CREATE POLICY "Fiscal configs delete admin" ON public.fiscal_configs FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND salon_id = fiscal_configs.salon_id AND role IN ('owner', 'admin')));

-- payments: sola lettura ai membri del salone (le scritture avvengono via service-role dai webhook)
DROP POLICY IF EXISTS "Payments read salon" ON public.payments;
CREATE POLICY "Payments read salon" ON public.payments FOR SELECT
  USING (salon_id = get_user_salon_id());

-- fiscal_documents: sola lettura ai membri del salone (scritture via service-role)
DROP POLICY IF EXISTS "Fiscal documents read salon" ON public.fiscal_documents;
CREATE POLICY "Fiscal documents read salon" ON public.fiscal_documents FOR SELECT
  USING (salon_id = get_user_salon_id());

-- TRIGGERS updated_at (riusa la funzione set_updated_at() gia' esistente)
DROP TRIGGER IF EXISTS set_payment_configs_updated_at ON public.payment_configs;
CREATE TRIGGER set_payment_configs_updated_at
  BEFORE UPDATE ON public.payment_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS set_payments_updated_at ON public.payments;
CREATE TRIGGER set_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS set_fiscal_configs_updated_at ON public.fiscal_configs;
CREATE TRIGGER set_fiscal_configs_updated_at
  BEFORE UPDATE ON public.fiscal_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS set_fiscal_documents_updated_at ON public.fiscal_documents;
CREATE TRIGGER set_fiscal_documents_updated_at
  BEFORE UPDATE ON public.fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
