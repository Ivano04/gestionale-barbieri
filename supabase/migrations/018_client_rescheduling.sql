BEGIN;
ALTER TABLE public.appointments ADD COLUMN reschedule_version integer NOT NULL DEFAULT 0,
 ADD COLUMN client_cancellation_deadline_at timestamptz;
CREATE TABLE public.appointment_reschedules (
 id uuid PRIMARY KEY, appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
 salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
 revision integer NOT NULL, old_start timestamptz NOT NULL, new_start timestamptz NOT NULL,
 new_end timestamptz NOT NULL, payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','failed')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, lease_token uuid, provider_email_id text, last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(appointment_id,revision)
);
ALTER TABLE public.appointment_reschedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_reschedules FROM anon,authenticated;
GRANT ALL ON public.appointment_reschedules TO service_role;

-- Same phase semantics as computeBusyPeriods in the booking engine.
CREATE FUNCTION public.appointment_busy_ranges(p_start timestamptz,p_end timestamptz,p_app integer,p_proc integer,p_fin integer)
RETURNS SETOF tstzrange LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE cursor_time timestamptz:=p_start; had_busy boolean:=false;
BEGIN
 IF coalesce(p_app,0)>0 THEN RETURN NEXT tstzrange(cursor_time,cursor_time+make_interval(mins=>p_app),'[)');cursor_time:=cursor_time+make_interval(mins=>p_app);had_busy:=true;END IF;
 cursor_time:=cursor_time+make_interval(mins=>greatest(coalesce(p_proc,0),0));
 IF coalesce(p_fin,0)>0 THEN RETURN NEXT tstzrange(cursor_time,cursor_time+make_interval(mins=>p_fin),'[)');had_busy:=true;END IF;
 IF NOT had_busy THEN RETURN NEXT tstzrange(p_start,p_end,'[)');END IF;
END $$;

-- All calendar writes take the same salon lock. Writes racing a reschedule
-- recheck the moved appointment in the database, including checkout holds.
CREATE FUNCTION public.guard_rescheduled_slot() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE slot_start timestamptz;slot_end timestamptz;stylist uuid;exclude_id uuid;check_all boolean:=false;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('salon-schedule:'||NEW.salon_id::text,0));
 IF TG_TABLE_NAME='appointments' THEN
  IF TG_OP='UPDATE' AND (NEW.start_time,NEW.end_time,NEW.buffer_end_time,NEW.stylist_id,NEW.status,NEW.reschedule_version)
   IS NOT DISTINCT FROM (OLD.start_time,OLD.end_time,OLD.buffer_end_time,OLD.stylist_id,OLD.status,OLD.reschedule_version) THEN RETURN NEW;END IF;
  IF NEW.status='cancelled' THEN RETURN NEW;END IF;
  slot_start:=NEW.start_time;slot_end:=coalesce(NEW.buffer_end_time,NEW.end_time);stylist:=NEW.stylist_id;exclude_id:=NEW.id;check_all:=NEW.reschedule_version>0;
 ELSIF TG_TABLE_NAME='time_blocks' THEN slot_start:=NEW.start_time;slot_end:=NEW.end_time;stylist:=NEW.stylist_id;
 ELSE
  IF NEW.status<>'pending' OR NEW.metadata->'slot'->>'start_time' IS NULL THEN RETURN NEW;END IF;
  slot_start:=(NEW.metadata->'slot'->>'start_time')::timestamptz;slot_end:=(NEW.metadata->'slot'->>'end_time')::timestamptz;
  stylist:=(NEW.metadata->'slot'->>'stylist_id')::uuid;
 END IF;
 IF EXISTS(SELECT 1 FROM appointments a LEFT JOIN services s ON s.id=a.service_id,
  LATERAL appointment_busy_ranges(a.start_time,coalesce(a.buffer_end_time,a.end_time),s.duration_application,s.duration_processing,s.duration_finishing) busy
  WHERE a.salon_id=NEW.salon_id AND a.id IS DISTINCT FROM exclude_id AND a.status<>'cancelled'
  AND (stylist IS NULL OR a.stylist_id IS NULL OR a.stylist_id=stylist)
  AND (check_all OR a.reschedule_version>0) AND busy && tstzrange(slot_start,slot_end,'[)')) THEN
  RAISE EXCEPTION 'Slot no longer available' USING ERRCODE='23P01';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_rescheduled_appointment BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.guard_rescheduled_slot();
CREATE TRIGGER guard_rescheduled_block BEFORE INSERT OR UPDATE ON public.time_blocks FOR EACH ROW EXECUTE FUNCTION public.guard_rescheduled_slot();
CREATE TRIGGER guard_rescheduled_hold BEFORE INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.guard_rescheduled_slot();

CREATE FUNCTION public.reschedule_client_appointment(p_id uuid,p_expected_start timestamptz,p_new_start timestamptz,p_request_id uuid,p_window_hours integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE a appointments%ROWTYPE;event appointment_reschedules%ROWTYPE;finish timestamptz;buffer_finish timestamptz;event_payload jsonb;
BEGIN
 SELECT * INTO a FROM appointments WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found');END IF;
 SELECT * INTO event FROM appointment_reschedules WHERE id=p_request_id;
 IF FOUND THEN
  IF event.appointment_id<>p_id OR event.new_start<>p_new_start THEN RETURN jsonb_build_object('ok',false,'reason','invalid_request');END IF;
  RETURN jsonb_build_object('ok',true,'eventId',event.id,'startTime',a.start_time,'alreadyApplied',true);
 END IF;
 IF a.status<>'confirmed' OR a.start_time<=now() THEN RETURN jsonb_build_object('ok',false,'reason','closed');END IF;
 IF a.start_time<>p_expected_start THEN RETURN jsonb_build_object('ok',false,'reason','stale');END IF;
 IF p_new_start IS NULL OR p_new_start<=now() OR p_new_start>now()+interval '365 days' OR p_window_hours NOT BETWEEN 1 AND 720 THEN RETURN jsonb_build_object('ok',false,'reason','invalid_time');END IF;
 IF p_new_start=a.start_time THEN RETURN jsonb_build_object('ok',true,'startTime',a.start_time,'alreadyApplied',true);END IF;
 IF a.stylist_id IS NULL OR a.service_id IS NULL OR a.end_time<=a.start_time THEN RETURN jsonb_build_object('ok',false,'reason','unsupported');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('salon-schedule:'||a.salon_id::text,0));
 finish:=p_new_start+(a.end_time-a.start_time);buffer_finish:=p_new_start+(coalesce(a.buffer_end_time,a.end_time)-a.start_time);
 IF EXISTS(SELECT 1 FROM payments WHERE appointment_id=a.id AND status IN ('refunded','partially_refunded')) THEN RETURN jsonb_build_object('ok',false,'reason','closed');END IF;
 IF EXISTS(SELECT 1 FROM time_blocks WHERE salon_id=a.salon_id AND (stylist_id IS NULL OR stylist_id=a.stylist_id)
  AND start_time<buffer_finish AND end_time>p_new_start)
 OR EXISTS(SELECT 1 FROM payments WHERE salon_id=a.salon_id AND status='pending' AND created_at>=now()-interval '15 minutes'
  AND metadata->'slot'->>'start_time' IS NOT NULL AND (metadata->'slot'->>'stylist_id' IS NULL OR metadata->'slot'->>'stylist_id'=a.stylist_id::text)
  AND (metadata->'slot'->>'start_time')::timestamptz<buffer_finish AND (metadata->'slot'->>'end_time')::timestamptz>p_new_start) THEN
  RETURN jsonb_build_object('ok',false,'reason','conflict');END IF;
 UPDATE appointments SET start_time=p_new_start,end_time=finish,buffer_end_time=buffer_finish,reschedule_version=reschedule_version+1,
 client_cancellation_deadline_at=least(coalesce(client_cancellation_deadline_at,a.start_time-make_interval(hours=>p_window_hours)),p_new_start-make_interval(hours=>p_window_hours)) WHERE id=a.id;
 SELECT jsonb_build_object('email',c.email,'clientName',c.first_name,'serviceName',s.name,'salonName',sal.name,
  'ghlId',a.ghl_appointment_id,'treatwellId',a.treatwell_appointment_id,'ualaStaffId',u.uala_staff_id,'ualaTreatmentId',s.uala_treatment_id)
 INTO event_payload FROM appointments x LEFT JOIN clients c ON c.id=x.client_id LEFT JOIN services s ON s.id=x.service_id
 LEFT JOIN salons sal ON sal.id=x.salon_id LEFT JOIN users u ON u.id=x.stylist_id WHERE x.id=a.id;
 INSERT INTO appointment_reschedules(id,appointment_id,salon_id,revision,old_start,new_start,new_end,payload)
 VALUES(p_request_id,a.id,a.salon_id,a.reschedule_version+1,a.start_time,p_new_start,finish,event_payload);
 -- Reminders follow the new date; fiscal and payment records are untouched.
 DELETE FROM notifications WHERE appointment_id=a.id AND type='reminder';
 RETURN jsonb_build_object('ok',true,'eventId',p_request_id,'startTime',p_new_start,'alreadyApplied',false);
END $$;
REVOKE ALL ON FUNCTION public.reschedule_client_appointment(uuid,timestamptz,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_client_appointment(uuid,timestamptz,timestamptz,uuid,integer) TO service_role;

CREATE FUNCTION public.claim_appointment_reschedule() RETURNS SETOF public.appointment_reschedules LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE appointment_reschedules SET state='failed',last_error_code='EMAIL_RECONCILIATION_REQUIRED' WHERE state IN ('pending','running') AND attempts>0 AND created_at<now()-interval '23 hours';
 RETURN QUERY WITH candidate AS (SELECT j.id FROM appointment_reschedules j WHERE (j.state='pending' AND j.available_at<=now() OR j.state='running' AND j.lease_until<now())
 AND NOT EXISTS(SELECT 1 FROM appointment_reschedules prev WHERE prev.appointment_id=j.appointment_id AND prev.revision<j.revision AND prev.state IN ('pending','running'))
 ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE appointment_reschedules j SET state='running',attempts=attempts+1,lease_until=now()+interval '120 seconds',lease_token=gen_random_uuid() FROM candidate c WHERE j.id=c.id RETURNING j.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_appointment_reschedule() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_appointment_reschedule() TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_appointment_fiscal_test(p_appointment_id uuid,p_initiator text,p_window_hours integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE appt appointments%ROWTYPE;pay payments%ROWTYPE;job refund_jobs%ROWTYPE;was_cancelled boolean;due boolean;
BEGIN
 IF p_initiator IS NULL OR p_initiator NOT IN ('client','staff') OR p_window_hours IS NULL OR p_window_hours<=0 THEN RAISE EXCEPTION 'Invalid cancellation policy';END IF;
 SELECT * INTO appt FROM appointments WHERE id=p_appointment_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found','refunded',false);END IF;
 was_cancelled:=appt.status='cancelled';
 IF NOT was_cancelled THEN
  due:=p_initiator='staff' OR coalesce(appt.client_cancellation_deadline_at,appt.start_time-make_interval(hours=>p_window_hours))>=now();
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

CREATE FUNCTION public.mark_notification_for_current_start(p_id uuid,p_type text,p_start timestamptz) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE a appointments%ROWTYPE;
BEGIN
 SELECT * INTO a FROM appointments WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR a.status='cancelled' OR a.start_time IS DISTINCT FROM p_start THEN RETURN false;END IF;
 INSERT INTO notifications(salon_id,appointment_id,type,status,sent_at) VALUES(a.salon_id,a.id,p_type,'sent',now()) ON CONFLICT(appointment_id,type) DO NOTHING;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.mark_notification_for_current_start(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_for_current_start(uuid,text,timestamptz) TO service_role;
COMMIT;
