BEGIN;
ALTER TABLE public.appointments ADD COLUMN cancellation_requested_at timestamptz,
 ADD COLUMN cancellation_refund_due boolean;
CREATE UNIQUE INDEX fiscal_cancellation_original_unique ON public.fiscal_documents(original_document_id)
 WHERE operation='cancellation' AND original_document_id IS NOT NULL;
CREATE TABLE public.refund_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE RESTRICT,
 payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT,
 appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
 provider payment_provider NOT NULL CHECK(provider='nexi'),mode provider_mode NOT NULL CHECK(mode='test'),
 provider_ref text NOT NULL,amount_cents integer NOT NULL CHECK(amount_cents>0),
 reason text NOT NULL CHECK(reason IN ('appointment_before_service','appointment_after_start')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','accepted','failed','uncertain')),
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,lease_until timestamptz,external_started_at timestamptz,
 provider_operation_id text,last_error_code text,accepted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.refund_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refund_jobs FROM anon,authenticated;
GRANT SELECT ON public.refund_jobs TO authenticated;GRANT ALL ON public.refund_jobs TO service_role;
CREATE POLICY refund_jobs_read_salon ON public.refund_jobs FOR SELECT TO authenticated USING(salon_id=get_user_salon_id());
CREATE FUNCTION public.guard_refund_job() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM payments p JOIN appointments a ON a.id=NEW.appointment_id
 WHERE p.id=NEW.payment_id AND p.salon_id=NEW.salon_id AND a.salon_id=NEW.salon_id AND p.appointment_id=a.id
 AND p.provider=NEW.provider AND p.metadata->>'payment_environment'='test'
 AND p.provider_payment_id=NEW.provider_ref AND p.amount_cents=NEW.amount_cents AND p.currency='EUR') THEN RAISE EXCEPTION 'Refund snapshot mismatch';END IF;
 IF TG_OP='UPDATE' AND (NEW.salon_id,NEW.payment_id,NEW.appointment_id,NEW.provider,NEW.mode,NEW.provider_ref,NEW.amount_cents,NEW.reason)
 IS DISTINCT FROM (OLD.salon_id,OLD.payment_id,OLD.appointment_id,OLD.provider,OLD.mode,OLD.provider_ref,OLD.amount_cents,OLD.reason)
 THEN RAISE EXCEPTION 'Refund snapshot immutable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_refund_job BEFORE INSERT OR UPDATE ON public.refund_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_refund_job();
CREATE FUNCTION public.cancel_appointment_fiscal_test(p_appointment_id uuid,p_initiator text,p_window_hours integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE appt appointments%ROWTYPE;pay payments%ROWTYPE;job refund_jobs%ROWTYPE;was_cancelled boolean;due boolean;
BEGIN
 IF p_initiator IS NULL OR p_initiator NOT IN ('client','staff') OR p_window_hours IS NULL OR p_window_hours<=0 THEN RAISE EXCEPTION 'Invalid cancellation policy';END IF;
 SELECT * INTO appt FROM appointments WHERE id=p_appointment_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found','refunded',false);END IF;
 was_cancelled:=appt.status='cancelled';
 IF NOT was_cancelled THEN
  due:=p_initiator='staff' OR appt.start_time>=now()+make_interval(hours=>p_window_hours);
  UPDATE appointments SET status='cancelled',cancellation_requested_at=now(),cancellation_refund_due=due WHERE id=appt.id;
  appt.cancellation_requested_at:=now();appt.cancellation_refund_due:=due;
 END IF;
 SELECT * INTO pay FROM payments WHERE appointment_id=appt.id AND salon_id=appt.salon_id FOR UPDATE;
 IF FOUND AND appt.cancellation_refund_due THEN
  IF pay.provider<>'nexi' OR pay.metadata->>'payment_environment' IS DISTINCT FROM 'test' OR pay.currency<>'EUR' THEN RAISE EXCEPTION 'TEST Nexi refund required';END IF;
  IF pay.status='succeeded' THEN
   INSERT INTO refund_jobs(salon_id,payment_id,appointment_id,provider,mode,provider_ref,amount_cents,reason)
   VALUES(pay.salon_id,pay.id,appt.id,'nexi','test',pay.provider_payment_id,pay.amount_cents,
     CASE WHEN appt.cancellation_requested_at<appt.start_time THEN 'appointment_before_service' ELSE 'appointment_after_start' END)
   ON CONFLICT(payment_id) DO NOTHING;
  END IF;
 END IF;
 SELECT * INTO job FROM refund_jobs WHERE payment_id=pay.id;
 RETURN jsonb_build_object('ok',true,'alreadyCancelled',was_cancelled,'refunded',coalesce(pay.status='refunded',false),
 'refundStatus',coalesce(job.state,'not_due'),'refundPending',coalesce(job.state IN ('pending','running'),false));
END $$;
CREATE FUNCTION public.claim_refund_test_job() RETURNS SETOF public.refund_jobs LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE refund_jobs SET state='uncertain',last_error_code='REFUND_RESPONSE_UNCERTAIN',lease_token=NULL,lease_until=NULL
 WHERE state='running' AND lease_until<=now() AND external_started_at IS NOT NULL;
 RETURN QUERY WITH candidate AS (SELECT id FROM refund_jobs WHERE
 (state='pending' AND available_at<=now()) OR (state='running' AND lease_until<=now() AND external_started_at IS NULL)
 ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE refund_jobs j SET state='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds'
 FROM candidate WHERE j.id=candidate.id RETURNING j.*;
END $$;
CREATE FUNCTION public.start_refund_test_call(p_id uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE refund_jobs SET external_started_at=now() WHERE id=p_id AND state='running' AND lease_token=p_token AND lease_until>now() AND external_started_at IS NULL;
 RETURN FOUND;
END $$;
CREATE FUNCTION public.finish_refund_test_job(p_id uuid,p_token uuid,p_outcome text,p_operation text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE job refund_jobs%ROWTYPE;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','failed','uncertain') THEN RAISE EXCEPTION 'Invalid refund outcome';END IF;
 SELECT * INTO job FROM refund_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR job.state<>'running' OR p_token IS NULL OR job.lease_token IS DISTINCT FROM p_token OR job.lease_until<=now() THEN RETURN false;END IF;
 IF p_outcome='accepted' THEN
  IF p_operation IS NULL OR length(p_operation)=0 OR job.external_started_at IS NULL THEN RAISE EXCEPTION 'Verified refund operation required';END IF;
  UPDATE payments SET status='refunded' WHERE id=job.payment_id AND salon_id=job.salon_id AND status IN ('succeeded','refunded');
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund payment status mismatch';END IF;
  INSERT INTO payment_events(salon_id,payment_id,provider,mode,event_key,status,amount_cents)
  VALUES(job.salon_id,job.payment_id,'nexi','test','refund:'||job.id::text,'refunded',job.amount_cents)
  ON CONFLICT(provider,mode,event_key) DO NOTHING;
 END IF;
 UPDATE refund_jobs SET state=p_outcome,provider_operation_id=p_operation,last_error_code=p_error,
 accepted_at=CASE WHEN p_outcome='accepted' THEN now() ELSE NULL END,lease_token=NULL,lease_until=NULL WHERE id=p_id;
 RETURN true;
END $$;
CREATE FUNCTION public.enqueue_refunded_fiscal_cancellations() RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE original fiscal_documents%ROWTYPE;cancel_id uuid;enqueued integer:=0;
BEGIN
 FOR original IN SELECT d.* FROM fiscal_documents d JOIN payments p ON p.id=d.payment_id
 JOIN refund_jobs r ON r.payment_id=p.id AND r.state='accepted' AND r.reason='appointment_before_service'
 WHERE d.operation='receipt' AND d.mode='test' AND d.provider='fiskaly' AND d.processing_status='completed'
 AND d.provider_record_id IS NOT NULL AND p.status='refunded'
 AND NOT EXISTS(SELECT 1 FROM fiscal_documents c WHERE c.original_document_id=d.id AND c.operation='cancellation')
 FOR UPDATE OF d SKIP LOCKED LOOP
  INSERT INTO fiscal_documents(salon_id,payment_id,appointment_id,provider,mode,amount_cents,operation,doc_type,
  original_document_id,operation_snapshot,configuration_snapshot)
  VALUES(original.salon_id,original.payment_id,original.appointment_id,'fiskaly','test',original.amount_cents,'cancellation','storno',original.id,
  jsonb_build_object('type','CANCELLATION','record',jsonb_build_object('id',original.provider_record_id)),original.configuration_snapshot)
  RETURNING id INTO cancel_id;
  INSERT INTO fiscal_jobs(salon_id,document_id) VALUES(original.salon_id,cancel_id);enqueued:=enqueued+1;
 END LOOP;
 RETURN enqueued;
END $$;
CREATE FUNCTION public.mark_original_fiscal_cancelled() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.operation='cancellation' AND NEW.processing_status='completed' AND OLD.processing_status IS DISTINCT FROM 'completed' THEN
  UPDATE fiscal_documents SET status='canceled' WHERE id=NEW.original_document_id AND salon_id=NEW.salon_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mark_original_fiscal_cancelled AFTER UPDATE ON public.fiscal_documents FOR EACH ROW EXECUTE FUNCTION public.mark_original_fiscal_cancelled();
REVOKE ALL ON FUNCTION public.cancel_appointment_fiscal_test(uuid,text,integer),public.claim_refund_test_job(),public.start_refund_test_call(uuid,uuid),
 public.finish_refund_test_job(uuid,uuid,text,text,text),public.enqueue_refunded_fiscal_cancellations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_appointment_fiscal_test(uuid,text,integer),public.claim_refund_test_job(),public.start_refund_test_call(uuid,uuid),
 public.finish_refund_test_job(uuid,uuid,text,text,text),public.enqueue_refunded_fiscal_cancellations() TO service_role;
COMMIT;
