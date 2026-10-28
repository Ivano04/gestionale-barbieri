BEGIN;
-- An imported appointment can retain an old buffer_end_time after its service
-- times change. Cleanup may extend occupancy, but must never shorten the service
-- or create a reversed range that blocks unrelated checkouts for the stylist.
-- Keep stored history intact; use the later service/buffer end for slot checks
-- and preserve this duration when the customer reschedules.
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
  slot_start:=NEW.start_time;slot_end:=greatest(NEW.end_time,NEW.buffer_end_time);stylist:=NEW.stylist_id;exclude_id:=NEW.id;exclude_payment:=NEW.id;
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
  LATERAL appointment_busy_ranges(a.start_time,greatest(a.end_time,a.buffer_end_time),
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

CREATE OR REPLACE FUNCTION public.reschedule_client_appointment(p_id uuid,p_expected_start timestamptz,p_new_start timestamptz,p_request_id uuid,p_window_hours integer)
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
 finish:=p_new_start+(a.end_time-a.start_time);buffer_finish:=p_new_start+(greatest(a.end_time,a.buffer_end_time)-a.start_time);
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

NOTIFY pgrst, 'reload schema';
COMMIT;
