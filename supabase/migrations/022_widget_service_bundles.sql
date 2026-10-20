BEGIN;
ALTER TABLE public.appointments ADD COLUMN booked_services jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK (jsonb_typeof(booked_services)='array' AND jsonb_array_length(booked_services)<=10);
COMMENT ON COLUMN public.appointments.booked_services IS 'Server snapshot of services paid together in the widget. Extra services remain in added_services for calendar compatibility.';

-- Keep legacy phase availability, while including the finishing tail and cleanup buffer.
CREATE OR REPLACE FUNCTION public.appointment_busy_ranges(p_start timestamptz,p_end timestamptz,p_app integer,p_proc integer,p_fin integer)
RETURNS SETOF tstzrange LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE cursor_time timestamptz:=p_start; had_busy boolean:=false;
BEGIN
 IF coalesce(p_app,0)>0 THEN RETURN NEXT tstzrange(cursor_time,cursor_time+make_interval(mins=>p_app),'[)');cursor_time:=cursor_time+make_interval(mins=>p_app);had_busy:=true;END IF;
 cursor_time:=cursor_time+make_interval(mins=>greatest(coalesce(p_proc,0),0));
 IF coalesce(p_fin,0)>0 THEN RETURN NEXT tstzrange(cursor_time,cursor_time+make_interval(mins=>p_fin),'[)');cursor_time:=cursor_time+make_interval(mins=>p_fin);had_busy:=true;END IF;
 IF NOT had_busy THEN RETURN NEXT tstzrange(p_start,p_end,'[)');
 ELSIF cursor_time<p_end THEN RETURN NEXT tstzrange(cursor_time,p_end,'[)');END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_rescheduled_slot() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE slot_start timestamptz;slot_end timestamptz;stylist uuid;exclude_id uuid;exclude_payment uuid;check_all boolean:=false;
BEGIN
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

CREATE FUNCTION public.reschedule_services_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE label text;
BEGIN
 SELECT concat_ws(' + ',coalesce(a.booked_services->0->>'name',s.name,'Servizio'),
  (SELECT string_agg(x->>'name',' + ' ORDER BY n) FROM jsonb_array_elements(coalesce(a.added_services,'[]')) WITH ORDINALITY e(x,n)))
 INTO label FROM appointments a LEFT JOIN services s ON s.id=a.service_id WHERE a.id=NEW.appointment_id;
 NEW.payload:=jsonb_set(NEW.payload,'{serviceName}',to_jsonb(label));RETURN NEW;
END $$;
CREATE TRIGGER reschedule_services_snapshot BEFORE INSERT ON public.appointment_reschedules FOR EACH ROW EXECUTE FUNCTION public.reschedule_services_snapshot();
NOTIFY pgrst, 'reload schema';
COMMIT;
