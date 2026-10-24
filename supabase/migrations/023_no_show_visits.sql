BEGIN;
-- An attendance correction never changes payments, fiscal documents or reserved times.
CREATE TABLE public.no_show_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), salon_id uuid NOT NULL REFERENCES salons(id),
 client_id uuid REFERENCES clients(id) ON DELETE SET NULL, anchor_id uuid NOT NULL REFERENCES appointments(id),
 visit_start timestamptz NOT NULL, visit_end timestamptz NOT NULL, visit_date date NOT NULL,
 member_ids uuid[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(salon_id,anchor_id,visit_start)
);
CREATE TABLE public.no_show_members (
 case_id uuid NOT NULL REFERENCES no_show_cases(id), appointment_id uuid NOT NULL REFERENCES appointments(id),
 salon_id uuid NOT NULL REFERENCES salons(id), previous_status text NOT NULL CHECK(previous_status IN('confirmed','completed')),
 marked_at timestamptz NOT NULL DEFAULT now(), marked_by uuid REFERENCES users(id) ON DELETE SET NULL,
 restored_at timestamptz, restored_by uuid REFERENCES users(id) ON DELETE SET NULL,
 PRIMARY KEY(case_id,appointment_id)
);
CREATE UNIQUE INDEX no_show_one_active_case ON no_show_members(appointment_id) WHERE restored_at IS NULL;
CREATE TABLE public.no_show_events (
 id uuid PRIMARY KEY, salon_id uuid NOT NULL REFERENCES salons(id), case_id uuid REFERENCES no_show_cases(id),
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL, actor_name text, action text NOT NULL CHECK(action IN('mark','restore','import')),
 request_snapshot jsonb NOT NULL, changes jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.no_show_emails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),salon_id uuid NOT NULL REFERENCES salons(id),client_id uuid NOT NULL REFERENCES clients(id),visit_date date NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','running','sent','cancelled','unavailable','blocked','failed','uncertain')),
 available_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',first_attempt_at timestamptz,
 attempts integer NOT NULL DEFAULT 0,lease_until timestamptz,lease_token uuid,
 recipient text,payload jsonb,provider_email_id text,last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,
 UNIQUE(salon_id,client_id,visit_date)
);
CREATE INDEX appointments_client_visit ON appointments(salon_id,client_id,start_time) WHERE status<>'cancelled';
CREATE INDEX no_show_email_queue ON no_show_emails(available_at) WHERE state IN('pending','running');
CREATE INDEX no_show_client_history ON no_show_cases(salon_id,client_id,visit_start DESC);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['no_show_cases','no_show_members','no_show_events','no_show_emails'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  EXECUTE format('CREATE POLICY salon_read ON public.%I FOR SELECT TO authenticated USING(salon_id=get_user_salon_id())',t);
 END LOOP;
END $$;

-- Connected intervals: only the same customer and salon, including cleanup buffers
-- between services. Cancelled entries cannot bridge otherwise separate visits.
CREATE FUNCTION public.appointment_visit(p_id uuid) RETURNS SETOF public.appointments
LANGUAGE sql STABLE SET search_path=public AS $$
 WITH RECURSIVE connected(id) AS (
  SELECT id FROM appointments WHERE id=p_id
  UNION
  SELECT a.id FROM connected c JOIN appointments prev ON prev.id=c.id
   JOIN appointments a ON a.salon_id=prev.salon_id AND a.client_id=prev.client_id
    AND a.status<>'cancelled' AND prev.status<>'cancelled'
    AND a.start_time<=greatest(prev.end_time,coalesce(prev.buffer_end_time,prev.end_time))
    AND greatest(a.end_time,coalesce(a.buffer_end_time,a.end_time))>=prev.start_time
 ) SELECT a.* FROM appointments a JOIN connected c USING(id) ORDER BY a.start_time,a.id
$$;

CREATE FUNCTION public.no_show_context(p_salon uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE a appointments%ROWTYPE;members jsonb;finish timestamptz;email_state jsonb;visit_day date;size integer;
BEGIN
 SELECT * INTO a FROM appointments WHERE id=p_id AND salon_id=p_salon;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT count(*),max(end_time),(min(start_time) AT TIME ZONE 'Europe/Rome')::date INTO size,finish,visit_day FROM appointment_visit(p_id);
 IF size>50 THEN RAISE EXCEPTION 'VISIT_TOO_LARGE';END IF;
 SELECT jsonb_agg(jsonb_build_object('id',v.id,'updatedAt',v.updated_at,'startTime',v.start_time,'endTime',v.end_time,'status',v.status,
  'serviceName',concat_ws(' + ',coalesce(v.booked_services->0->>'name',s.name,'Servizio'),(SELECT string_agg(x->>'name',' + ' ORDER BY n) FROM jsonb_array_elements(coalesce(v.added_services,'[]')) WITH ORDINALITY e(x,n))),
  'stylistName',u.full_name) ORDER BY v.start_time,v.id) INTO members FROM appointment_visit(p_id) v LEFT JOIN services s ON s.id=v.service_id LEFT JOIN users u ON u.id=v.stylist_id;
 SELECT jsonb_build_object('state',state,'availableAt',available_at,'sentAt',sent_at,'reason',last_error_code) INTO email_state
  FROM no_show_emails WHERE salon_id=p_salon AND client_id=a.client_id AND visit_date=visit_day;
 RETURN jsonb_build_object('members',members,'visitEnd',finish,'canMark',a.status<>'cancelled' AND finish<=now(),'serverNow',now(),
  'email',email_state,'hasEmail',EXISTS(SELECT 1 FROM clients WHERE id=a.client_id AND nullif(trim(email),'') IS NOT NULL));
END $$;

CREATE FUNCTION public.change_no_show(p_salon uuid,p_actor uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE anchor appointments%ROWTYPE;v appointments%ROWTYPE;m no_show_members%ROWTYPE;c no_show_cases%ROWTYPE;event no_show_events%ROWTYPE;
 key uuid:=(p_input->>'requestId')::uuid;action text:=p_input->>'action';ids uuid[];group_ids uuid[];
 first_time timestamptz;last_time timestamptz;visit_day date;group_anchor uuid;changed jsonb:='[]';answer jsonb;old_flag text;mail text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_actor AND salon_id=p_salon AND role IN('owner','admin','receptionist','stylist')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
 IF key IS NULL OR action IS NULL OR action NOT IN('mark','restore') OR jsonb_typeof(p_input->'ids') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_input->'ids') NOT BETWEEN 1 AND 50 OR jsonb_typeof(p_input->'expected') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_REQUEST';END IF;
 SELECT array_agg(x::uuid ORDER BY x::uuid) INTO ids FROM jsonb_array_elements_text(p_input->'ids') e(x);
 IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_REQUEST';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('salon-schedule:'||p_salon::text,0));
 SELECT * INTO event FROM no_show_events WHERE id=key;
 IF FOUND THEN
  IF event.salon_id<>p_salon OR event.actor_id IS DISTINCT FROM p_actor OR event.request_snapshot IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'CONFLICTING_REQUEST';END IF;
  RETURN event.result;
 END IF;
 SELECT * INTO anchor FROM appointments WHERE id=(p_input->>'appointmentId')::uuid AND salon_id=p_salon;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND';END IF;
 SELECT array_agg(id ORDER BY id),min(start_time),max(end_time),(array_agg(id ORDER BY start_time,id))[1]
  INTO group_ids,first_time,last_time,group_anchor FROM appointment_visit(anchor.id);
 IF cardinality(group_ids)>50 OR NOT ids<@group_ids THEN RAISE EXCEPTION 'VISIT_MISMATCH';END IF;
 PERFORM 1 FROM appointments WHERE id=ANY(group_ids) ORDER BY id FOR UPDATE;
 IF jsonb_array_length(p_input->'expected')<>cardinality(group_ids) OR EXISTS(
  SELECT 1 FROM appointments a WHERE a.id=ANY(group_ids) AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(p_input->'expected') e WHERE (e->>'id')::uuid=a.id AND (e->>'updatedAt')::timestamptz=a.updated_at)) THEN RAISE EXCEPTION 'STALE_VISIT';END IF;
 IF action='mark' AND last_time>now() THEN RAISE EXCEPTION 'VISIT_NOT_FINISHED';END IF;
 visit_day:=(first_time AT TIME ZONE 'Europe/Rome')::date;
 IF action='mark' THEN
  INSERT INTO no_show_cases(salon_id,client_id,anchor_id,visit_start,visit_end,visit_date,member_ids)
   VALUES(p_salon,anchor.client_id,group_anchor,first_time,last_time,visit_day,group_ids)
   ON CONFLICT(salon_id,anchor_id,visit_start) DO UPDATE SET visit_end=EXCLUDED.visit_end,member_ids=EXCLUDED.member_ids RETURNING * INTO c;
 END IF;
 old_flag:=current_setting('localvista.attendance_change',true);PERFORM set_config('localvista.attendance_change','yes',true);
 FOR v IN SELECT * FROM appointments WHERE id=ANY(ids) ORDER BY id LOOP
  IF action='mark' THEN
   IF v.status='no_show' THEN CONTINUE;END IF;
   IF v.status::text NOT IN('confirmed','completed') THEN RAISE EXCEPTION 'APPOINTMENT_CLOSED';END IF;
   INSERT INTO no_show_members(case_id,appointment_id,salon_id,previous_status,marked_by) VALUES(c.id,v.id,p_salon,v.status::text,p_actor)
    ON CONFLICT(case_id,appointment_id) DO UPDATE SET previous_status=EXCLUDED.previous_status,marked_at=now(),marked_by=p_actor,restored_at=NULL,restored_by=NULL;
   UPDATE appointments SET status='no_show' WHERE id=v.id;
   changed:=changed||jsonb_build_array(jsonb_build_object('appointmentId',v.id,'from',v.status,'to','no_show'));
  ELSE
   IF v.status<>'no_show' THEN CONTINUE;END IF;
   SELECT * INTO m FROM no_show_members WHERE appointment_id=v.id AND restored_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'ATTENDANCE_HISTORY_MISSING';END IF;
   SELECT * INTO c FROM no_show_cases WHERE id=m.case_id;
   IF m.previous_status='completed' THEN UPDATE appointments SET status='completed' WHERE id=v.id;
   ELSE UPDATE appointments SET status='confirmed' WHERE id=v.id;END IF;
   UPDATE no_show_members SET restored_at=now(),restored_by=p_actor WHERE case_id=m.case_id AND appointment_id=v.id;
   changed:=changed||jsonb_build_array(jsonb_build_object('appointmentId',v.id,'from','no_show','to',m.previous_status));
  END IF;
 END LOOP;
 PERFORM set_config('localvista.attendance_change',coalesce(old_flag,''),true);
 IF anchor.client_id IS NOT NULL AND jsonb_array_length(changed)>0 THEN
  IF action='mark' THEN
   SELECT nullif(lower(trim(email)),'') INTO mail FROM clients WHERE id=anchor.client_id;
   INSERT INTO no_show_emails(salon_id,client_id,visit_date,state,last_error_code)
    VALUES(p_salon,anchor.client_id,visit_day,CASE WHEN mail IS NULL THEN 'unavailable' ELSE 'pending' END,CASE WHEN mail IS NULL THEN 'NO_EMAIL' END)
    ON CONFLICT(salon_id,client_id,visit_date) DO UPDATE SET state=EXCLUDED.state,last_error_code=EXCLUDED.last_error_code,available_at=now()+interval '30 minutes'
     WHERE no_show_emails.first_attempt_at IS NULL AND no_show_emails.state IN('pending','cancelled','unavailable');
  ELSE
   UPDATE no_show_emails e SET state='cancelled',last_error_code='ATTENDANCE_RESTORED',lease_until=NULL,lease_token=NULL
    WHERE e.salon_id=p_salon AND e.client_id=anchor.client_id AND e.state IN('pending','unavailable','blocked','running') AND NOT EXISTS(
     SELECT 1 FROM no_show_cases nc JOIN no_show_members nm ON nm.case_id=nc.id JOIN appointments na ON na.id=nm.appointment_id
      WHERE nc.salon_id=e.salon_id AND nc.client_id=e.client_id AND nc.visit_date=e.visit_date AND nm.restored_at IS NULL AND na.status='no_show');
  END IF;
 END IF;
 answer:=jsonb_build_object('ok',true,'changed',jsonb_array_length(changed),'caseId',c.id);
 INSERT INTO no_show_events(id,salon_id,case_id,actor_id,actor_name,action,request_snapshot,changes,result) VALUES(key,p_salon,c.id,p_actor,(SELECT full_name FROM users WHERE id=p_actor),action,p_input,changed,answer);
 RETURN answer;
END $$;

-- Import legacy no-shows into the audit history without sending historical emails.
DO $$ DECLARE a appointments%ROWTYPE;c uuid;ids uuid[];start_at timestamptz;end_at timestamptz;first_id uuid; BEGIN
 FOR a IN SELECT * FROM appointments WHERE status='no_show' ORDER BY start_time,id LOOP
  IF EXISTS(SELECT 1 FROM no_show_members WHERE appointment_id=a.id) THEN CONTINUE;END IF;
  SELECT array_agg(id ORDER BY id),min(start_time),max(end_time),(array_agg(id ORDER BY start_time,id))[1] INTO ids,start_at,end_at,first_id FROM appointment_visit(a.id);
  INSERT INTO no_show_cases(salon_id,client_id,anchor_id,visit_start,visit_end,visit_date,member_ids) VALUES(a.salon_id,a.client_id,first_id,start_at,end_at,(start_at AT TIME ZONE 'Europe/Rome')::date,ids) RETURNING id INTO c;
  INSERT INTO no_show_members(case_id,appointment_id,salon_id,previous_status) SELECT c,id,salon_id,'confirmed' FROM appointments WHERE id=ANY(ids) AND status='no_show';
  INSERT INTO no_show_events(id,salon_id,case_id,action,request_snapshot,changes,result) VALUES(gen_random_uuid(),a.salon_id,c,'import','{}','[]','{}');
 END LOOP;
END $$;

CREATE FUNCTION public.guard_attendance_change() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_setting('localvista.attendance_change',true)='yes' THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status='no_show' THEN RAISE EXCEPTION 'USE_ATTENDANCE_ACTION';END IF;
 ELSE
  IF (NEW.status='no_show' OR OLD.status='no_show') AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'USE_ATTENDANCE_ACTION';END IF;
  IF OLD.status='no_show' AND (NEW.start_time,NEW.end_time,NEW.buffer_end_time,NEW.stylist_id,NEW.client_id,NEW.service_id)
    IS DISTINCT FROM (OLD.start_time,OLD.end_time,OLD.buffer_end_time,OLD.stylist_id,OLD.client_id,OLD.service_id) THEN RAISE EXCEPTION 'RESTORE_ATTENDANCE_FIRST';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attendance_guard BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION guard_attendance_change();

CREATE FUNCTION public.notification_delivery_allowed(p_id uuid,p_start timestamptz,p_type text) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE a appointments%ROWTYPE;finish timestamptz;
BEGIN
 SELECT * INTO a FROM appointments WHERE id=p_id;
 IF NOT FOUND OR a.status::text NOT IN('confirmed','completed') OR a.start_time IS DISTINCT FROM p_start THEN RETURN false;END IF;
 IF p_type='review' THEN
  SELECT max(end_time) INTO finish FROM appointment_visit(a.id);
  RETURN finish+interval '1 hour'<=now() AND finish+interval '24 hours'>=now();
 ELSIF p_type='reminder' THEN RETURN a.start_time>now();
 ELSE RETURN true;END IF;
END $$;

CREATE FUNCTION public.claim_no_show_email() RETURNS SETOF public.no_show_emails LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE no_show_emails SET state='uncertain',last_error_code='EMAIL_RECONCILIATION_REQUIRED' WHERE state IN('pending','running') AND first_attempt_at<now()-interval '23 hours';
 UPDATE no_show_emails SET state='cancelled',last_error_code='MESSAGE_EXPIRED' WHERE state='pending' AND first_attempt_at IS NULL AND available_at<now()-interval '24 hours';
 RETURN QUERY WITH candidate AS (SELECT id FROM no_show_emails WHERE (state='pending' AND available_at<=now() OR state='running' AND lease_until<now())
  ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE no_show_emails e SET state='running',lease_until=now()+interval '90 seconds',lease_token=gen_random_uuid() FROM candidate c WHERE e.id=c.id RETURNING e.*;
END $$;

CREATE FUNCTION public.prepare_no_show_email(p_id uuid,p_lease uuid) RETURNS SETOF public.no_show_emails LANGUAGE plpgsql SET search_path=public AS $$
DECLARE e no_show_emails%ROWTYPE;client_row clients%ROWTYPE;salon_row salons%ROWTYPE;
BEGIN
 SELECT * INTO e FROM no_show_emails WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR e.state<>'running' OR e.lease_token IS DISTINCT FROM p_lease OR e.lease_until<=now() THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM no_show_cases c JOIN no_show_members m ON m.case_id=c.id JOIN appointments a ON a.id=m.appointment_id
  WHERE c.salon_id=e.salon_id AND c.client_id=e.client_id AND c.visit_date=e.visit_date AND m.restored_at IS NULL AND a.status='no_show') THEN
  UPDATE no_show_emails SET state='cancelled',last_error_code='ATTENDANCE_RESTORED',lease_until=NULL,lease_token=NULL WHERE id=e.id;RETURN;
 END IF;
 IF e.first_attempt_at IS NULL THEN
  SELECT * INTO client_row FROM clients WHERE id=e.client_id AND salon_id=e.salon_id;SELECT * INTO salon_row FROM salons WHERE id=e.salon_id;
  IF client_row.email IS NULL OR trim(client_row.email)!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
   UPDATE no_show_emails SET state='unavailable',last_error_code='NO_EMAIL',lease_until=NULL,lease_token=NULL WHERE id=e.id;RETURN;
  END IF;
  UPDATE no_show_emails SET recipient=lower(trim(client_row.email)),payload=jsonb_build_object('clientName',client_row.first_name,'salonName',salon_row.name,'salonPhone',salon_row.phone,'visitDate',e.visit_date),first_attempt_at=now() WHERE id=e.id;
 END IF;
 RETURN QUERY UPDATE no_show_emails SET attempts=attempts+1 WHERE id=e.id RETURNING *;
END $$;

-- A delivered review is recorded even if attendance changed during the external
-- send: restoring the visit must not cause that accepted email to be sent again.
CREATE FUNCTION public.record_review_sent(p_id uuid,p_salon uuid) RETURNS void LANGUAGE sql SET search_path=public AS $$
 INSERT INTO notifications(salon_id,appointment_id,type,status,sent_at) SELECT p_salon,id,'review','sent',now() FROM appointments WHERE id=p_id AND salon_id=p_salon
 ON CONFLICT(appointment_id,type) DO NOTHING
$$;

CREATE FUNCTION public.immutable_attendance_event() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 -- Preserve the actor's name if an account is later removed. Only the FK may
 -- clear a reference to a user who no longer exists; audit content stays fixed.
 IF TG_OP='UPDATE' THEN
  IF OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
   AND (to_jsonb(NEW)-'actor_id')=(to_jsonb(OLD)-'actor_id')
   AND NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.actor_id) THEN RETURN NEW;END IF;
 END IF;
 RAISE EXCEPTION 'IMMUTABLE_ATTENDANCE_EVENT';
END $$;
CREATE TRIGGER no_show_event_immutable BEFORE UPDATE OR DELETE ON no_show_events FOR EACH ROW EXECUTE FUNCTION immutable_attendance_event();

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'appointment_visit','no_show_context','change_no_show','guard_attendance_change','notification_delivery_allowed','claim_no_show_email','prepare_no_show_email','record_review_sent','immutable_attendance_event') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.guard_rescheduled_slot() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE slot_start timestamptz;slot_end timestamptz;stylist uuid;exclude_id uuid;exclude_payment uuid;check_all boolean:=false;
BEGIN
 IF TG_TABLE_NAME='appointments' AND TG_OP='UPDATE' AND current_setting('localvista.attendance_change',true)='yes' THEN
  IF (NEW.start_time,NEW.end_time,NEW.buffer_end_time,NEW.stylist_id,NEW.client_id,NEW.service_id,NEW.booked_services,NEW.added_services)
   IS NOT DISTINCT FROM (OLD.start_time,OLD.end_time,OLD.buffer_end_time,OLD.stylist_id,OLD.client_id,OLD.service_id,OLD.booked_services,OLD.added_services) THEN RETURN NEW;END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('salon-schedule:'||NEW.salon_id::text,0));
 IF TG_TABLE_NAME='appointments' THEN
  IF TG_OP='UPDATE' THEN
   IF jsonb_array_length(OLD.booked_services)>0 AND NEW.booked_services IS DISTINCT FROM OLD.booked_services THEN RAISE EXCEPTION 'Paid service snapshot is immutable';END IF;
   IF (NEW.start_time,NEW.end_time,NEW.buffer_end_time,NEW.stylist_id,NEW.status,NEW.reschedule_version,NEW.added_services,NEW.booked_services)
    IS NOT DISTINCT FROM (OLD.start_time,OLD.end_time,OLD.buffer_end_time,OLD.stylist_id,OLD.status,OLD.reschedule_version,OLD.added_services,OLD.booked_services) THEN RETURN NEW;END IF;
  END IF;
  IF NEW.status='cancelled' THEN RETURN NEW;END IF;
  slot_start:=NEW.start_time;slot_end:=coalesce(NEW.buffer_end_time,NEW.end_time);stylist:=NEW.stylist_id;exclude_id:=NEW.id;exclude_payment:=NEW.id;
  check_all:=NEW.reschedule_version>0 OR jsonb_array_length(NEW.booked_services)>0 OR jsonb_array_length(coalesce(NEW.added_services,'[]'))>0;
 ELSIF TG_TABLE_NAME='time_blocks' THEN slot_start:=NEW.start_time;slot_end:=NEW.end_time;stylist:=NEW.stylist_id;
 ELSE
  IF NEW.status<>'pending' OR NEW.metadata->'slot'->>'start_time' IS NULL THEN RETURN NEW;END IF;
  IF TG_OP='UPDATE' AND (NEW.status,NEW.metadata->'slot') IS NOT DISTINCT FROM (OLD.status,OLD.metadata->'slot') THEN RETURN NEW;END IF;
  slot_start:=(NEW.metadata->'slot'->>'start_time')::timestamptz;slot_end:=(NEW.metadata->'slot'->>'end_time')::timestamptz;
  stylist:=(NEW.metadata->'slot'->>'stylist_id')::uuid;exclude_payment:=NEW.id;exclude_id:=NEW.appointment_id;
  check_all:=NEW.metadata->>'booking_version'='2';
 END IF;
 IF slot_start IS NULL OR slot_end IS NULL OR slot_end<=slot_start THEN RAISE EXCEPTION 'Invalid booking interval';END IF;
 IF EXISTS(SELECT 1 FROM appointments a LEFT JOIN services s ON s.id=a.service_id,
  LATERAL appointment_busy_ranges(a.start_time,coalesce(a.buffer_end_time,a.end_time),
   CASE WHEN jsonb_array_length(a.booked_services)>0 OR jsonb_array_length(coalesce(a.added_services,'[]'))>0 THEN NULL ELSE s.duration_application END,
   CASE WHEN jsonb_array_length(a.booked_services)>0 OR jsonb_array_length(coalesce(a.added_services,'[]'))>0 THEN NULL ELSE s.duration_processing END,
   CASE WHEN jsonb_array_length(a.booked_services)>0 OR jsonb_array_length(coalesce(a.added_services,'[]'))>0 THEN NULL ELSE s.duration_finishing END) busy
  WHERE a.salon_id=NEW.salon_id AND a.id IS DISTINCT FROM exclude_id AND a.status<>'cancelled'
  AND (stylist IS NULL OR a.stylist_id IS NULL OR a.stylist_id=stylist)
  AND (check_all OR a.reschedule_version>0 OR jsonb_array_length(a.booked_services)>0 OR jsonb_array_length(coalesce(a.added_services,'[]'))>0)
  AND busy && tstzrange(slot_start,slot_end,'[)')) THEN RAISE EXCEPTION 'Slot no longer available' USING ERRCODE='23P01';END IF;
 IF check_all AND TG_TABLE_NAME<>'time_blocks' AND EXISTS(SELECT 1 FROM time_blocks b WHERE b.salon_id=NEW.salon_id
  AND (stylist IS NULL OR b.stylist_id IS NULL OR b.stylist_id=stylist) AND b.start_time<slot_end AND b.end_time>slot_start)
 THEN RAISE EXCEPTION 'Slot no longer available' USING ERRCODE='23P01';END IF;
 -- Also protect pending checkouts from staff writes and other checkouts. A succeeded
 -- payment waiting for webhook confirmation must not silently lose its slot.
 IF EXISTS(SELECT 1 FROM payments p WHERE p.salon_id=NEW.salon_id AND p.id IS DISTINCT FROM exclude_payment
  AND (exclude_id IS NULL OR p.appointment_id IS DISTINCT FROM exclude_id)
  AND ((p.status='pending' AND p.created_at>=now()-interval '15 minutes') OR (p.status='succeeded' AND p.appointment_id IS NULL))
  AND p.metadata->'slot'->>'start_time' IS NOT NULL
  AND (stylist IS NULL OR p.metadata->'slot'->>'stylist_id' IS NULL OR p.metadata->'slot'->>'stylist_id'=stylist::text)
  AND (p.metadata->'slot'->>'start_time')::timestamptz<slot_end AND (p.metadata->'slot'->>'end_time')::timestamptz>slot_start)
 THEN RAISE EXCEPTION 'Slot no longer available' USING ERRCODE='23P01';END IF;
 RETURN NEW;
END $$;


NOTIFY pgrst, 'reload schema';
COMMIT;
