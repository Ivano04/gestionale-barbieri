BEGIN;
CREATE TABLE public.fiscal_email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL UNIQUE REFERENCES public.fiscal_documents(id) ON DELETE RESTRICT,
  mode provider_mode NOT NULL CHECK (mode='test'),
  recipient text NOT NULL,
  payload jsonb NOT NULL,
  pdf_path text NOT NULL,
  pdf_sha256 text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','sent','retry','uncertain','failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  first_attempt_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  provider_email_id text,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fiscal_email_jobs_due ON public.fiscal_email_jobs(available_at) WHERE state IN ('pending','retry','running');
ALTER TABLE public.fiscal_email_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_email_jobs FROM anon,authenticated;
GRANT SELECT ON public.fiscal_email_jobs TO authenticated;
GRANT ALL ON public.fiscal_email_jobs TO service_role;
CREATE POLICY fiscal_email_read_salon ON public.fiscal_email_jobs FOR SELECT TO authenticated
USING (salon_id=public.get_user_salon_id());
CREATE FUNCTION public.guard_fiscal_email_job() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE document public.fiscal_documents;
BEGIN
  SELECT * INTO document FROM public.fiscal_documents WHERE id=NEW.document_id;
  IF document.id IS NULL OR document.salon_id<>NEW.salon_id OR document.mode<>NEW.mode
    OR document.processing_status<>'completed' OR document.pdf_storage_path IS DISTINCT FROM NEW.pdf_path
    OR NEW.pdf_path<>NEW.salon_id::text||'/test/'||NEW.document_id::text||'.pdf'
    OR NEW.payload->>'to' IS DISTINCT FROM NEW.recipient
    OR NEW.payload->>'from' IS NULL OR NEW.payload->>'subject' IS NULL
    OR NEW.payload->>'text' IS NULL OR NEW.payload->>'html' IS NULL THEN
    RAISE EXCEPTION 'Invalid fiscal email snapshot';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.salon_id,NEW.document_id,NEW.mode,NEW.recipient,NEW.payload,NEW.pdf_path,NEW.pdf_sha256,NEW.idempotency_key)
    IS DISTINCT FROM (OLD.salon_id,OLD.document_id,OLD.mode,OLD.recipient,OLD.payload,OLD.pdf_path,OLD.pdf_sha256,OLD.idempotency_key) THEN
    RAISE EXCEPTION 'Fiscal email snapshot immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_fiscal_email_job BEFORE INSERT OR UPDATE ON public.fiscal_email_jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_email_job();
CREATE FUNCTION public.claim_fiscal_email_job() RETURNS SETOF public.fiscal_email_jobs
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  -- Stop recovery outside the provider deduplication window (24h, one hour margin).
  UPDATE public.fiscal_email_jobs SET state='uncertain',last_error_code='IDEMPOTENCY_WINDOW_EXPIRED',lease_token=NULL,lease_until=NULL
  WHERE state IN ('pending','retry','running') AND first_attempt_at<now()-interval '23 hours';
  RETURN QUERY WITH candidate AS (
    SELECT id FROM public.fiscal_email_jobs
    WHERE (state IN ('pending','retry') AND available_at<=now()) OR (state='running' AND lease_until<=now())
    ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE public.fiscal_email_jobs job SET state='running',attempts=job.attempts+1,
    first_attempt_at=COALESCE(job.first_attempt_at,now()),lease_until=now()+interval '120 seconds',lease_token=gen_random_uuid()
    FROM candidate WHERE job.id=candidate.id RETURNING job.*;
END $$;
CREATE FUNCTION public.checkpoint_fiscal_email_job(p_id uuid,p_token uuid,p_state text,p_provider_id text DEFAULT NULL,p_error text DEFAULT NULL,p_delay integer DEFAULT 30)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF p_state NOT IN ('sent','retry','uncertain','failed') OR p_delay<0 OR p_delay>3600 THEN RAISE EXCEPTION 'Invalid fiscal email outcome'; END IF;
  IF p_state='sent' AND (p_provider_id IS NULL OR length(p_provider_id)=0) THEN RAISE EXCEPTION 'Email ID required'; END IF;
  UPDATE public.fiscal_email_jobs SET state=p_state,provider_email_id=COALESCE(p_provider_id,provider_email_id),
    last_error_code=p_error,available_at=now()+make_interval(secs=>p_delay),
    sent_at=CASE WHEN p_state='sent' THEN now() ELSE sent_at END,lease_token=NULL,lease_until=NULL
  WHERE id=p_id AND state='running' AND lease_token=p_token AND lease_until>now();
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_fiscal_email_job() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.checkpoint_fiscal_email_job(uuid,uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fiscal_email_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.checkpoint_fiscal_email_job(uuid,uuid,text,text,text,integer) TO service_role;
COMMIT;
