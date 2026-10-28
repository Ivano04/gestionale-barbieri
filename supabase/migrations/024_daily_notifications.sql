BEGIN;
CREATE TABLE public.daily_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 salon_id uuid NOT NULL REFERENCES salons(id), client_id uuid NOT NULL REFERENCES clients(id),
 visit_date date NOT NULL, type text NOT NULL CHECK(type IN('reminder','review')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','running','sent','cancelled','unavailable','blocked','uncertain')),
 due_at timestamptz, expires_at timestamptz, available_at timestamptz,
 context jsonb, payload jsonb, first_attempt_at timestamptz, attempts integer NOT NULL DEFAULT 0,
 lease_token uuid, lease_until timestamptz, provider_email_id text, last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
 UNIQUE(salon_id,client_id,visit_date,type)
);
CREATE INDEX daily_notifications_queue ON daily_notifications(available_at) WHERE state IN('pending','running');
CREATE INDEX daily_notifications_history ON daily_notifications(salon_id,client_id,visit_date DESC);
ALTER TABLE daily_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON daily_notifications FROM anon,authenticated;
GRANT SELECT(id,salon_id,client_id,visit_date,type,state,due_at,sent_at,last_error_code,created_at) ON daily_notifications TO authenticated;
GRANT ALL ON daily_notifications TO service_role;
CREATE POLICY daily_notifications_salon ON daily_notifications FOR SELECT TO authenticated USING(salon_id=get_user_salon_id());

-- Calendar day boundaries use Rome, including days of 23 or 25 hours.
CREATE FUNCTION public.daily_visit_context(p_salon uuid,p_client uuid,p_day date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('clientName',c.first_name,'email',lower(trim(c.email)),
  'salonName',s.name,'visitDate',p_day,'firstStart',min(a.start_time),'lastEnd',max(a.end_time),
  'appointments',jsonb_agg(jsonb_build_object('id',a.id,'startTime',a.start_time,'endTime',a.end_time,
    'status',a.status,'serviceName',concat_ws(' + ',coalesce(a.booked_services->0->>'name',sv.name,'Servizio'),
     (SELECT string_agg(x->>'name',' + ' ORDER BY n) FROM jsonb_array_elements(coalesce(a.added_services,'[]')) WITH ORDINALITY e(x,n))),
    'stylistName',u.full_name) ORDER BY a.start_time,a.id))
 FROM appointments a JOIN clients c ON c.id=a.client_id AND c.salon_id=a.salon_id JOIN salons s ON s.id=a.salon_id
 LEFT JOIN services sv ON sv.id=a.service_id LEFT JOIN users u ON u.id=a.stylist_id
 WHERE a.salon_id=p_salon AND a.client_id=p_client AND a.status IN('confirmed','completed')
  AND a.start_time >= (p_day::timestamp AT TIME ZONE 'Europe/Rome')
  AND a.start_time < ((p_day+1)::timestamp AT TIME ZONE 'Europe/Rome')
 GROUP BY c.id,c.first_name,c.email,s.id,s.name
$$;

-- Import accepted legacy sends. Reschedule history recovers the visit date as
-- it was when a message was sent, rather than assigning it to a later new date.
CREATE FUNCTION public.legacy_notification_day(p_id uuid,p_sent timestamptz) RETURNS date
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT (coalesce((SELECT r.old_start FROM appointment_reschedules r WHERE r.appointment_id=a.id
  AND r.created_at>p_sent ORDER BY r.created_at LIMIT 1),a.start_time) AT TIME ZONE 'Europe/Rome')::date
 FROM appointments a WHERE a.id=p_id
$$;
INSERT INTO daily_notifications(salon_id,client_id,visit_date,type,state,sent_at,last_error_code)
 SELECT a.salon_id,a.client_id,legacy_notification_day(a.id,n.sent_at),n.type,'sent',min(n.sent_at),'LEGACY_DELIVERY'
 FROM notifications n JOIN appointments a ON a.id=n.appointment_id AND a.salon_id=n.salon_id
 WHERE n.type IN('reminder','review') AND n.status='sent' AND a.client_id IS NOT NULL
 GROUP BY a.salon_id,a.client_id,legacy_notification_day(a.id,n.sent_at),n.type
 ON CONFLICT(salon_id,client_id,visit_date,type) DO NOTHING;
CREATE FUNCTION public.capture_legacy_daily_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE a appointments%ROWTYPE;
BEGIN
 IF NEW.type NOT IN('reminder','review') OR NEW.status<>'sent' THEN RETURN NEW;END IF;
 SELECT * INTO a FROM appointments WHERE id=NEW.appointment_id AND salon_id=NEW.salon_id;
 IF a.client_id IS NULL THEN RETURN NEW;END IF;
 INSERT INTO daily_notifications(salon_id,client_id,visit_date,type,state,sent_at,last_error_code)
 VALUES(a.salon_id,a.client_id,legacy_notification_day(a.id,NEW.sent_at),NEW.type,'sent',NEW.sent_at,'LEGACY_DELIVERY')
 ON CONFLICT(salon_id,client_id,visit_date,type) DO UPDATE SET state='sent',sent_at=coalesce(daily_notifications.sent_at,EXCLUDED.sent_at),last_error_code='LEGACY_DELIVERY';
 RETURN NEW;
END $$;
CREATE TRIGGER capture_legacy_daily_delivery AFTER INSERT OR UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION capture_legacy_daily_delivery();

-- Disable the previous per-appointment cron at the database boundary during
-- deployment/rollback. Confirmations remain immediate and respect attendance.
CREATE OR REPLACE FUNCTION public.notification_delivery_allowed(p_id uuid,p_start timestamptz,p_type text) RETURNS boolean
LANGUAGE sql SET search_path=public AS $$
 SELECT p_type='confirmation' AND EXISTS(SELECT 1 FROM appointments WHERE id=p_id AND start_time=p_start AND status IN('confirmed','completed'))
$$;

CREATE FUNCTION public.reconcile_daily_email(p_id uuid,p_test_email text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j daily_notifications%ROWTYPE;ctx jsonb;due timestamptz;expiry timestamptz;next_state text;reason text;
BEGIN
 SELECT * INTO j FROM daily_notifications WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.state IN('sent','uncertain') THEN RETURN;END IF;
 ctx:=daily_visit_context(j.salon_id,j.client_id,j.visit_date);
 IF j.first_attempt_at IS NOT NULL THEN
  IF lower(trim(p_test_email)) IS DISTINCT FROM j.payload->>'to' OR ctx IS DISTINCT FROM j.context OR j.first_attempt_at<=now()-interval '23 hours' OR j.expires_at<=now() THEN
   UPDATE daily_notifications SET state='uncertain',last_error_code=CASE WHEN ctx IS DISTINCT FROM j.context THEN 'VISIT_CHANGED_AFTER_ATTEMPT' ELSE 'EMAIL_RECONCILIATION_REQUIRED' END WHERE id=j.id;
  END IF;
  RETURN;
 END IF;
 due:=CASE j.type WHEN 'reminder' THEN (ctx->>'firstStart')::timestamptz-interval '2 hours' ELSE (ctx->>'lastEnd')::timestamptz+interval '1 hour' END;
 expiry:=CASE j.type WHEN 'reminder' THEN (ctx->>'firstStart')::timestamptz ELSE (ctx->>'lastEnd')::timestamptz+interval '24 hours' END;
 IF ctx IS NULL THEN next_state:='cancelled';reason:='NO_ELIGIBLE_APPOINTMENTS';
 ELSIF expiry<=now() THEN next_state:='cancelled';reason:='MESSAGE_EXPIRED';
 ELSIF coalesce(ctx->>'email','')!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN next_state:='unavailable';reason:='NO_EMAIL';
 ELSIF nullif(lower(trim(p_test_email)),'') IS NULL OR ctx->>'email'<>lower(trim(p_test_email)) THEN next_state:='blocked';reason:='EMAIL_TEST_RECIPIENT_REQUIRED';
 ELSE next_state:='pending';reason:=NULL;END IF;
 -- Leave an active lease alone only while its complete context is unchanged.
 IF j.state='running' AND j.lease_until>now() AND ctx IS NOT DISTINCT FROM j.context AND next_state='pending' THEN RETURN;END IF;
 UPDATE daily_notifications SET context=ctx,due_at=due,expires_at=expiry,available_at=due,state=next_state,last_error_code=reason,
  lease_until=NULL,lease_token=NULL WHERE id=j.id;
END $$;

CREATE FUNCTION public.refresh_daily_notifications(p_test_email text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE r record;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('daily-notification-refresh',0)) THEN RETURN;END IF;
 INSERT INTO daily_notifications(salon_id,client_id,visit_date,type)
 SELECT DISTINCT a.salon_id,a.client_id,(a.start_time AT TIME ZONE 'Europe/Rome')::date,t.type
 FROM appointments a CROSS JOIN (VALUES('reminder'),('review')) t(type)
 WHERE a.client_id IS NOT NULL AND a.end_time>now()-interval '26 hours'
 ON CONFLICT(salon_id,client_id,visit_date,type) DO NOTHING;
 FOR r IN SELECT id FROM daily_notifications WHERE state IN('pending','running','unavailable','blocked','cancelled')
  AND (visit_date >= (now() AT TIME ZONE 'Europe/Rome')::date-2 OR state IN('pending','running')) ORDER BY id LOOP
  PERFORM reconcile_daily_email(r.id,p_test_email);
 END LOOP;
END $$;

-- Staff calendar writes run as authenticated. Only this trigger may invalidate
-- the private queue on their behalf; callers cannot enqueue or send directly.
CREATE FUNCTION public.invalidate_daily_visit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.salon_id,NEW.client_id,NEW.start_time,NEW.end_time,NEW.status,NEW.service_id,NEW.stylist_id,NEW.booked_services,NEW.added_services)
  IS NOT DISTINCT FROM (OLD.salon_id,OLD.client_id,OLD.start_time,OLD.end_time,OLD.status,OLD.service_id,OLD.stylist_id,OLD.booked_services,OLD.added_services) THEN RETURN NEW;END IF;
 -- Lock affected jobs in the same order as the refresh worker.
 PERFORM 1 FROM daily_notifications d WHERE
  (TG_OP<>'INSERT' AND d.salon_id=OLD.salon_id AND d.client_id=OLD.client_id AND d.visit_date=(OLD.start_time AT TIME ZONE 'Europe/Rome')::date)
  OR (TG_OP<>'DELETE' AND d.salon_id=NEW.salon_id AND d.client_id=NEW.client_id AND d.visit_date=(NEW.start_time AT TIME ZONE 'Europe/Rome')::date)
 ORDER BY d.id FOR UPDATE;
 -- Keeping the lease on an uncertain in-flight request lets the worker record
 -- provider acceptance; a client correction cannot retract an accepted email.
 IF TG_OP<>'INSERT' THEN
  UPDATE daily_notifications SET state=CASE WHEN first_attempt_at IS NULL THEN 'pending' ELSE 'uncertain' END,
   last_error_code='VISIT_CHANGED',lease_token=CASE WHEN first_attempt_at IS NOT NULL THEN lease_token END,
   lease_until=CASE WHEN first_attempt_at IS NOT NULL THEN lease_until END
  WHERE salon_id=OLD.salon_id AND client_id=OLD.client_id AND visit_date=(OLD.start_time AT TIME ZONE 'Europe/Rome')::date AND state IN('pending','running','cancelled','unavailable','blocked');
 END IF;
 IF TG_OP<>'DELETE' THEN
  UPDATE daily_notifications SET state=CASE WHEN first_attempt_at IS NULL THEN 'pending' ELSE 'uncertain' END,
   last_error_code='VISIT_CHANGED',lease_token=CASE WHEN first_attempt_at IS NOT NULL THEN lease_token END,
   lease_until=CASE WHEN first_attempt_at IS NOT NULL THEN lease_until END
  WHERE salon_id=NEW.salon_id AND client_id=NEW.client_id AND visit_date=(NEW.start_time AT TIME ZONE 'Europe/Rome')::date AND state IN('pending','running','cancelled','unavailable','blocked');
 END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER invalidate_daily_visit AFTER INSERT OR UPDATE OR DELETE ON appointments FOR EACH ROW EXECUTE FUNCTION invalidate_daily_visit();

CREATE FUNCTION public.claim_daily_email() RETURNS SETOF daily_notifications LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE daily_notifications SET state='uncertain',last_error_code='EMAIL_RECONCILIATION_REQUIRED'
 WHERE state IN('pending','running') AND first_attempt_at<=now()-interval '23 hours';
 RETURN QUERY WITH candidate AS (
  SELECT id FROM daily_notifications WHERE
   (state='pending' AND available_at<=now() AND due_at<=now() AND expires_at>now())
   OR (state='running' AND lease_until<now())
  ORDER BY due_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE daily_notifications j SET state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds'
 FROM candidate c WHERE j.id=c.id RETURNING j.*;
END $$;
CREATE FUNCTION public.prepare_daily_email(p_id uuid,p_lease uuid,p_test_email text) RETURNS SETOF daily_notifications LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 PERFORM reconcile_daily_email(p_id,p_test_email);
 RETURN QUERY SELECT * FROM daily_notifications WHERE id=p_id AND state='running' AND lease_token=p_lease AND lease_until>now() AND due_at<=now() AND expires_at>now();
END $$;
CREATE FUNCTION public.authorize_daily_email(p_id uuid,p_lease uuid,p_context jsonb,p_payload jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j daily_notifications%ROWTYPE;ctx jsonb;
BEGIN
 SELECT * INTO j FROM daily_notifications WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'running' OR j.lease_token IS DISTINCT FROM p_lease OR j.lease_until<=now() OR j.due_at>now() OR j.expires_at<=now() THEN RETURN false;END IF;
 ctx:=daily_visit_context(j.salon_id,j.client_id,j.visit_date);
 IF ctx IS DISTINCT FROM j.context OR p_context IS DISTINCT FROM j.context THEN
  UPDATE daily_notifications SET state=CASE WHEN first_attempt_at IS NULL THEN 'pending' ELSE 'uncertain' END,last_error_code='VISIT_CHANGED' WHERE id=p_id;RETURN false;
 END IF;
 IF j.first_attempt_at IS NOT NULL THEN
  IF j.payload IS DISTINCT FROM p_payload OR j.first_attempt_at<=now()-interval '23 hours' THEN RETURN false;END IF;
 ELSE
  IF p_payload->>'to' IS DISTINCT FROM ctx->>'email' OR nullif(p_payload->>'from','') IS NULL OR nullif(p_payload->>'html','') IS NULL OR nullif(p_payload->>'subject','') IS NULL THEN RAISE EXCEPTION 'INVALID_EMAIL_PAYLOAD';END IF;
 END IF;
 UPDATE daily_notifications SET payload=p_payload,first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1 WHERE id=p_id;
 RETURN true;
END $$;
CREATE FUNCTION public.daily_email_current(p_id uuid,p_lease uuid) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j daily_notifications%ROWTYPE;
BEGIN
 SELECT * INTO j FROM daily_notifications WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'running' OR j.lease_token IS DISTINCT FROM p_lease OR j.lease_until<=now() OR j.due_at>now() OR j.expires_at<=now() THEN RETURN false;END IF;
 IF daily_visit_context(j.salon_id,j.client_id,j.visit_date) IS DISTINCT FROM j.context THEN
  UPDATE daily_notifications SET state='uncertain',last_error_code='VISIT_CHANGED_AFTER_ATTEMPT' WHERE id=p_id;RETURN false;
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.finish_daily_email(p_id uuid,p_lease uuid,p_provider_id text) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j daily_notifications%ROWTYPE;
BEGIN
 SELECT * INTO j FROM daily_notifications WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF j.state='sent' THEN RETURN true;END IF;
 IF j.lease_token IS DISTINCT FROM p_lease OR j.payload IS NULL THEN RETURN false;END IF;
 IF nullif(p_provider_id,'') IS NOT NULL THEN
  UPDATE daily_notifications SET state='sent',sent_at=now(),provider_email_id=p_provider_id,last_error_code=CASE WHEN j.state='uncertain' THEN 'CHANGED_DURING_SEND' END,lease_token=NULL,lease_until=NULL WHERE id=p_id;
 ELSIF j.state='running' THEN
  UPDATE daily_notifications SET state=CASE WHEN attempts>=5 THEN 'uncertain' ELSE 'pending' END,
   available_at=now()+least(interval '30 minutes',interval '1 minute'*power(2,least(attempts,5))),last_error_code='EMAIL_SEND_UNCERTAIN',lease_until=NULL,lease_token=NULL WHERE id=p_id;
 END IF;
 RETURN true;
END $$;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'daily_visit_context','legacy_notification_day','capture_legacy_daily_delivery','reconcile_daily_email','refresh_daily_notifications',
  'invalidate_daily_visit','claim_daily_email','prepare_daily_email','authorize_daily_email','daily_email_current','finish_daily_email') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
