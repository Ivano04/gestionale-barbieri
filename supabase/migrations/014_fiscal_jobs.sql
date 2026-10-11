-- Fiscal TEST persistence foundation. Apply separately before wiring the worker.
BEGIN;

ALTER TABLE public.fiscal_configs
  ADD COLUMN organization_id uuid,
  ADD COLUMN taxpayer_id uuid,
  ADD COLUMN location_id uuid,
  ADD COLUMN system_id uuid;

ALTER TABLE public.fiscal_documents
  ADD COLUMN appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN original_document_id uuid REFERENCES public.fiscal_documents(id) ON DELETE RESTRICT,
  ADD COLUMN mode provider_mode NOT NULL DEFAULT 'test',
  ADD COLUMN operation text NOT NULL DEFAULT 'receipt' CHECK (operation IN ('receipt', 'cancellation', 'correction')),
  ADD COLUMN operation_snapshot jsonb,
  ADD COLUMN configuration_snapshot jsonb,
  ADD COLUMN intention_key uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN transaction_key uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN provider_intention_id uuid,
  ADD COLUMN provider_record_id uuid,
  ADD COLUMN provider_state text,
  ADD COLUMN provider_mode text,
  ADD COLUMN pdf_storage_path text,
  ADD COLUMN last_error_code text,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN issued_at timestamptz,
  ADD COLUMN processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'completed', 'retry', 'uncertain', 'failed'));

CREATE UNIQUE INDEX fiscal_receipt_payment_unique ON public.fiscal_documents(payment_id, mode)
  WHERE payment_id IS NOT NULL AND operation = 'receipt';
CREATE UNIQUE INDEX fiscal_provider_record_unique ON public.fiscal_documents(provider, mode, provider_record_id)
  WHERE provider_record_id IS NOT NULL;
CREATE UNIQUE INDEX fiscal_intention_key_unique ON public.fiscal_documents(intention_key);
CREATE UNIQUE INDEX fiscal_transaction_key_unique ON public.fiscal_documents(transaction_key);

-- Internal outbox. No direct access for browser roles.
CREATE TABLE public.fiscal_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL UNIQUE REFERENCES public.fiscal_documents(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fiscal_jobs_ready ON public.fiscal_jobs(state, available_at);
ALTER TABLE public.fiscal_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_jobs FROM anon, authenticated;
GRANT ALL ON public.fiscal_jobs TO service_role;

-- Unique lease token prevents an old worker from completing a newer lease.
CREATE FUNCTION public.claim_fiscal_job(p_lease_seconds integer DEFAULT 60)
RETURNS SETOF public.fiscal_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_lease_seconds < 15 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'Invalid lease duration';
  END IF;
  RETURN QUERY
  WITH candidate AS (
    SELECT id FROM public.fiscal_jobs
    WHERE (state = 'pending' AND available_at <= now())
       OR (state = 'running' AND lease_until < now())
    ORDER BY available_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.fiscal_jobs j
  SET state = 'running', attempts = attempts + 1,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      lease_token = gen_random_uuid(), updated_at = now()
  FROM candidate c WHERE j.id = c.id
  RETURNING j.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_fiscal_job(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fiscal_job(integer) TO service_role;

-- Verified payment events; no raw webhook body or secrets retained here.
CREATE TABLE public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  provider payment_provider NOT NULL,
  mode provider_mode NOT NULL DEFAULT 'test',
  event_key text NOT NULL,
  status payment_status NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, mode, event_key)
);
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_events FROM anon, authenticated;
GRANT ALL ON public.payment_events TO service_role;

-- Server-only entry point; caller verifies provider signature and builds immutable fiscal payload.
CREATE FUNCTION public.register_paid_fiscal_test(
  p_payment_id uuid, p_event_key text, p_amount_cents integer, p_operation jsonb
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  payment public.payments%ROWTYPE;
  config public.fiscal_configs%ROWTYPE;
  document_id uuid;
  existing_event public.payment_events%ROWTYPE;
BEGIN
  SELECT * INTO payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR payment.amount_cents <> p_amount_cents OR payment.currency <> 'EUR' THEN
    RAISE EXCEPTION 'Payment amount or currency mismatch';
  END IF;
  IF payment.metadata->>'payment_environment' IS DISTINCT FROM 'test' THEN RAISE EXCEPTION 'Payment environment not TEST'; END IF;
  IF payment.status NOT IN ('pending', 'authorized', 'succeeded') THEN
    RAISE EXCEPTION 'Payment state not eligible';
  END IF;
  IF p_event_key IS NULL OR length(p_event_key) = 0 OR length(p_event_key) > 200 THEN
    RAISE EXCEPTION 'Invalid event key';
  END IF;
  IF p_operation IS NULL OR jsonb_typeof(p_operation) <> 'object' OR
     p_operation->>'type' IS DISTINCT FROM 'RECEIPT' OR
     (p_operation #>> '{totals,vat,inclusive}')::numeric * 100 IS DISTINCT FROM p_amount_cents::numeric THEN
    RAISE EXCEPTION 'Invalid receipt snapshot or total';
  END IF;
  SELECT * INTO config FROM public.fiscal_configs
    WHERE salon_id = payment.salon_id AND provider = 'fiskaly' AND enabled
    FOR SHARE;
  IF NOT FOUND OR config.mode <> 'test' OR config.system_id IS NULL OR config.organization_id IS NULL OR config.taxpayer_id IS NULL OR config.location_id IS NULL THEN
    RAISE EXCEPTION 'Enabled TEST fiscal configuration required';
  END IF;

  SELECT * INTO existing_event FROM public.payment_events
    WHERE provider = payment.provider AND mode = 'test' AND event_key = p_event_key;
  IF FOUND AND (existing_event.payment_id <> payment.id OR existing_event.amount_cents <> p_amount_cents
                OR existing_event.status <> 'succeeded') THEN
    RAISE EXCEPTION 'Conflicting payment event';
  END IF;
  INSERT INTO public.payment_events(salon_id,payment_id,provider,mode,event_key,status,amount_cents)
    VALUES(payment.salon_id,payment.id,payment.provider,'test',p_event_key,'succeeded',p_amount_cents)
    ON CONFLICT(provider,mode,event_key) DO NOTHING;
  -- Recheck after conflict: concurrent events may have appeared while waiting.
  SELECT * INTO existing_event FROM public.payment_events
    WHERE provider = payment.provider AND mode = 'test' AND event_key = p_event_key;
  IF existing_event.payment_id <> payment.id OR existing_event.amount_cents <> p_amount_cents
     OR existing_event.status <> 'succeeded' THEN RAISE EXCEPTION 'Conflicting payment event'; END IF;

  SELECT id INTO document_id FROM public.fiscal_documents
    WHERE payment_id = payment.id AND mode = 'test' AND operation = 'receipt';
  IF document_id IS NULL THEN
    INSERT INTO public.fiscal_documents(salon_id,payment_id,appointment_id,provider,mode,
      amount_cents,operation_snapshot,configuration_snapshot)
    VALUES(payment.salon_id,payment.id,payment.appointment_id,'fiskaly','test',
      p_amount_cents,p_operation,jsonb_build_object(
        'provider','fiskaly','mode','test','organization_id',config.organization_id,
        'taxpayer_id',config.taxpayer_id,'location_id',config.location_id,'system_id',config.system_id))
    RETURNING id INTO document_id;
  END IF;
  IF (SELECT operation_snapshot FROM public.fiscal_documents WHERE id=document_id) IS DISTINCT FROM p_operation THEN
    RAISE EXCEPTION 'Duplicate payment with different receipt snapshot';
  END IF;
  INSERT INTO public.fiscal_jobs(salon_id,document_id)
    VALUES(payment.salon_id,document_id) ON CONFLICT ON CONSTRAINT fiscal_jobs_document_id_key DO NOTHING;
  UPDATE public.payments SET status = 'succeeded' WHERE id = payment.id;
  RETURN document_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_paid_fiscal_test(uuid,text,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_paid_fiscal_test(uuid,text,integer,jsonb) TO service_role;

CREATE FUNCTION public.guard_fiscal_document()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.payment_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.payments WHERE id=NEW.payment_id AND salon_id=NEW.salon_id
  ) THEN RAISE EXCEPTION 'Payment salon mismatch'; END IF;
  IF NEW.appointment_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.appointments WHERE id=NEW.appointment_id AND salon_id=NEW.salon_id
  ) THEN RAISE EXCEPTION 'Appointment salon mismatch'; END IF;
  IF NEW.original_document_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.fiscal_documents WHERE id=NEW.original_document_id
      AND salon_id=NEW.salon_id AND provider=NEW.provider AND mode=NEW.mode AND id<>NEW.id
  ) THEN RAISE EXCEPTION 'Original document mismatch'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.salon_id IS DISTINCT FROM OLD.salon_id OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
      OR NEW.operation IS DISTINCT FROM OLD.operation
      OR NEW.original_document_id IS DISTINCT FROM OLD.original_document_id
      OR NEW.operation_snapshot IS DISTINCT FROM OLD.operation_snapshot
      OR NEW.configuration_snapshot IS DISTINCT FROM OLD.configuration_snapshot
      OR NEW.intention_key IS DISTINCT FROM OLD.intention_key
      OR NEW.transaction_key IS DISTINCT FROM OLD.transaction_key THEN
      RAISE EXCEPTION 'Fiscal snapshot is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_fiscal_document BEFORE INSERT OR UPDATE ON public.fiscal_documents
FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_document();

CREATE FUNCTION public.guard_fiscal_job()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.fiscal_documents WHERE id=NEW.document_id AND salon_id=NEW.salon_id) THEN
    RAISE EXCEPTION 'Job document salon mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_fiscal_job BEFORE INSERT OR UPDATE ON public.fiscal_jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_job();


CREATE FUNCTION public.checkpoint_fiscal_job(
 p_job_id uuid,p_token uuid,p_outcome text,p_intention uuid DEFAULT NULL,p_record uuid DEFAULT NULL,
 p_state text DEFAULT NULL,p_mode text DEFAULT NULL,p_error text DEFAULT NULL,p_delay integer DEFAULT 30
) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE job public.fiscal_jobs%ROWTYPE;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('processing','completed','retry','uncertain','failed')
    OR p_delay IS NULL OR p_delay<0 OR p_delay>3600 THEN RAISE EXCEPTION 'Invalid checkpoint'; END IF;
 SELECT * INTO job FROM public.fiscal_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR job.state<>'running' OR job.lease_token IS DISTINCT FROM p_token OR
    p_token IS NULL OR job.lease_until<=now() THEN RETURN false; END IF;
 IF p_outcome='completed' AND (p_record IS NULL OR p_state IS DISTINCT FROM 'COMPLETED'
    OR p_mode IS DISTINCT FROM 'FINISHED') THEN RAISE EXCEPTION 'Unverified completion'; END IF;
 IF EXISTS(SELECT 1 FROM public.fiscal_documents WHERE id=job.document_id AND
    ((provider_intention_id IS NOT NULL AND p_intention IS NOT NULL AND provider_intention_id<>p_intention)
    OR (provider_record_id IS NOT NULL AND p_record IS NOT NULL AND provider_record_id<>p_record))) THEN
    RAISE EXCEPTION 'Provider identifier conflict'; END IF;
 UPDATE public.fiscal_documents SET
   provider_intention_id=coalesce(p_intention,provider_intention_id),
   provider_record_id=coalesce(p_record,provider_record_id),
   provider_state=coalesce(p_state,provider_state),provider_mode=coalesce(p_mode,provider_mode),
   processing_status=p_outcome,attempt_count=job.attempts,last_error_code=p_error,
   status=CASE WHEN p_outcome='completed' THEN 'confirmed'::fiscal_doc_status
               WHEN p_outcome='failed' THEN 'failed'::fiscal_doc_status ELSE status END,
   issued_at=CASE WHEN p_outcome='completed' THEN coalesce(issued_at,now()) ELSE issued_at END
 WHERE id=job.document_id AND salon_id=job.salon_id;
 UPDATE public.fiscal_jobs SET
   state=CASE WHEN p_outcome='processing' THEN 'running'
              WHEN p_outcome='completed' THEN 'done' WHEN p_outcome='failed' THEN 'failed' ELSE 'pending' END,
   available_at=now()+make_interval(secs=>p_delay),
   lease_until=CASE WHEN p_outcome='processing' THEN now()+interval '120 seconds' ELSE NULL END,
   lease_token=CASE WHEN p_outcome='processing' THEN p_token ELSE NULL END,
   last_error_code=p_error,updated_at=now() WHERE id=job.id;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.checkpoint_fiscal_job(uuid,uuid,text,uuid,uuid,text,text,text,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_fiscal_job(uuid,uuid,text,uuid,uuid,text,text,text,integer) TO service_role;

COMMIT;