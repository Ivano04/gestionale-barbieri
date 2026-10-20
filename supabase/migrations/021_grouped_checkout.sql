BEGIN;
-- One sale/document can settle several appointments. Each appointment can belong
-- to only one base sale, including older checkout routes and historical sales.
CREATE TABLE public.salon_sale_appointments (
 appointment_id uuid PRIMARY KEY REFERENCES public.appointments(id) ON DELETE RESTRICT,
 sale_id uuid NOT NULL REFERENCES public.salon_sales(id) ON DELETE RESTRICT,
 salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE RESTRICT,
 appointment_snapshot jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX sale_appointments_sale ON public.salon_sale_appointments(salon_id,sale_id);
INSERT INTO public.salon_sale_appointments(appointment_id,sale_id,salon_id,appointment_snapshot)
 SELECT a.id,s.id,s.salon_id,jsonb_build_object('id',a.id,'clientId',a.client_id,'startTime',a.start_time,'serviceId',a.service_id)
 FROM public.salon_sales s JOIN public.appointments a ON a.id=s.appointment_id
 WHERE s.kind='appointment';
ALTER TABLE public.salon_sale_appointments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_sale_appointments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.salon_sale_appointments TO authenticated;
GRANT SELECT,INSERT ON public.salon_sale_appointments TO service_role;
CREATE POLICY sale_appointments_read ON public.salon_sale_appointments FOR SELECT TO authenticated USING(salon_id=get_user_salon_id());
CREATE TRIGGER sale_appointments_immutable BEFORE UPDATE OR DELETE ON public.salon_sale_appointments
 FOR EACH ROW EXECUTE FUNCTION public.commerce_immutable();

CREATE FUNCTION public.guard_sale_appointment() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE a appointments%ROWTYPE;b appointments%ROWTYPE;s salon_sales%ROWTYPE;
BEGIN
 SELECT * INTO a FROM appointments WHERE id=NEW.appointment_id AND salon_id=NEW.salon_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND';END IF;
 SELECT * INTO s FROM salon_sales WHERE id=NEW.sale_id AND salon_id=NEW.salon_id AND kind='appointment';
 IF NOT FOUND THEN RAISE EXCEPTION 'SALE_APPOINTMENT_MISMATCH';END IF;
 IF EXISTS(SELECT 1 FROM salon_sale_appointments WHERE appointment_id=a.id)
 OR EXISTS(SELECT 1 FROM payments WHERE appointment_id=a.id AND status IN('pending','authorized','succeeded','refunded','partially_refunded'))
 OR EXISTS(SELECT 1 FROM fiscal_documents WHERE appointment_id=a.id AND sale_id IS NULL AND operation='receipt') THEN RAISE EXCEPTION 'ALREADY_PAID';END IF;
 IF s.appointment_id<>a.id THEN
  SELECT * INTO b FROM appointments WHERE id=s.appointment_id;
  IF a.client_id IS NULL OR a.client_id IS DISTINCT FROM b.client_id
  OR (a.start_time AT TIME ZONE 'Europe/Rome')::date IS DISTINCT FROM (b.start_time AT TIME ZONE 'Europe/Rome')::date
  THEN RAISE EXCEPTION 'GROUP_MISMATCH';END IF;
 END IF;
 NEW.appointment_snapshot:=jsonb_build_object('id',a.id,'clientId',a.client_id,'startTime',a.start_time,'serviceId',a.service_id);
 RETURN NEW;
END $$;
CREATE TRIGGER guard_sale_appointment BEFORE INSERT ON public.salon_sale_appointments
 FOR EACH ROW EXECUTE FUNCTION public.guard_sale_appointment();
CREATE FUNCTION public.link_base_sale() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.kind='appointment' THEN
  INSERT INTO salon_sale_appointments(appointment_id,sale_id,salon_id) VALUES(NEW.appointment_id,NEW.id,NEW.salon_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER link_base_sale AFTER INSERT ON public.salon_sales FOR EACH ROW EXECUTE FUNCTION public.link_base_sale();

-- Reuse the established receipt, promotion, credit, stock and outbox transaction.
ALTER FUNCTION public.register_commerce_test(uuid,uuid,jsonb) RENAME TO register_commerce_single_test;
CREATE FUNCTION public.register_commerce_test(p_salon uuid,p_actor uuid,p_input jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public AS $$
DECLARE s salon_sales%ROWTYPE;a appointments%ROWTYPE;r customer_rewards%ROWTYPE;
 selected jsonb:=p_input->'appointments';item jsonb;ids uuid[];day date;first_start timestamptz;
 key uuid:=(p_input->>'requestId')::uuid;aid uuid:=(p_input->>'appointmentId')::uuid;
 cid uuid:=(p_input->>'clientId')::uuid;doc uuid;matched integer:=0;
BEGIN
 PERFORM commerce_staff(p_salon,p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('commerce:'||p_salon::text,0));
 -- Replays use the original request even if appointments were subsequently edited.
 SELECT * INTO s FROM salon_sales WHERE id=key;
 IF FOUND THEN
  IF s.salon_id<>p_salon OR s.request_snapshot IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'CONFLICTING_REQUEST';END IF;
  SELECT id INTO doc FROM fiscal_documents WHERE sale_id=key AND operation='receipt';RETURN doc;
 END IF;
 IF selected IS NULL THEN RETURN register_commerce_single_test(p_salon,p_actor,p_input);END IF;
 IF jsonb_typeof(selected) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_GROUP';END IF;
 IF jsonb_array_length(selected) NOT BETWEEN 2 AND 20 OR p_input->>'kind' IS DISTINCT FROM 'appointment'
 OR cid IS NULL OR aid IS NULL OR p_input->>'quoteId' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_GROUP';END IF;
 SELECT array_agg((value->>'id')::uuid ORDER BY value->>'id') INTO ids FROM jsonb_array_elements(selected);
 IF array_position(ids,NULL) IS NOT NULL OR NOT aid=ANY(ids)
 OR cardinality(ids)<>(SELECT count(DISTINCT v) FROM unnest(ids) v) THEN RAISE EXCEPTION 'INVALID_GROUP';END IF;
 PERFORM checkout_basket_total(p_input->'lines');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'lines') l WHERE l->>'kind'='service'
 AND (l->>'appointmentId' IS NULL OR NOT (l->>'appointmentId')::uuid=ANY(ids))) THEN RAISE EXCEPTION 'GROUP_LINES_MISMATCH';END IF;
 FOR a IN SELECT * FROM appointments WHERE id=ANY(ids) AND salon_id=p_salon ORDER BY id FOR UPDATE LOOP
  matched:=matched+1;
  IF a.client_id IS DISTINCT FROM cid THEN RAISE EXCEPTION 'GROUP_MISMATCH';END IF;
  IF day IS NULL THEN day:=(a.start_time AT TIME ZONE 'Europe/Rome')::date;END IF;
  IF day<>(a.start_time AT TIME ZONE 'Europe/Rome')::date THEN RAISE EXCEPTION 'GROUP_MISMATCH';END IF;
  first_start:=least(first_start,a.start_time);
  SELECT value INTO item FROM jsonb_array_elements(selected) WHERE value->>'id'=a.id::text;
  IF a.updated_at IS DISTINCT FROM (item->>'expectedUpdate')::timestamptz THEN RAISE EXCEPTION 'STALE_APPOINTMENT';END IF;
  IF a.status::text NOT IN('confirmed','completed') THEN RAISE EXCEPTION 'APPOINTMENT_CLOSED';END IF;
  IF EXISTS(SELECT 1 FROM salon_sale_appointments WHERE appointment_id=a.id)
  OR EXISTS(SELECT 1 FROM payments WHERE appointment_id=a.id AND status IN('pending','authorized','succeeded','refunded','partially_refunded'))
  OR EXISTS(SELECT 1 FROM fiscal_documents WHERE appointment_id=a.id AND sale_id IS NULL AND operation='receipt') THEN RAISE EXCEPTION 'ALREADY_PAID';END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'lines') l WHERE l->>'kind'='service' AND l->>'appointmentId'=a.id::text)
  THEN RAISE EXCEPTION 'GROUP_LINES_MISMATCH';END IF;
 END LOOP;
 IF matched<>cardinality(ids) THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND';END IF;
 IF p_input->>'rewardId' IS NOT NULL THEN
  SELECT * INTO r FROM customer_rewards WHERE id=(p_input->>'rewardId')::uuid AND salon_id=p_salon AND client_id=cid;
  IF r.earned_appointment_id=ANY(ids) OR first_start<=(SELECT end_time FROM appointments WHERE id=r.earned_appointment_id)
  THEN RAISE EXCEPTION 'REWARD_UNAVAILABLE';END IF;
 END IF;
 doc:=register_commerce_single_test(p_salon,p_actor,p_input);
 INSERT INTO salon_sale_appointments(appointment_id,sale_id,salon_id)
 SELECT v,key,p_salon FROM unnest(ids) v WHERE v<>aid;
 RETURN doc;
END $$;
REVOKE ALL ON FUNCTION public.register_commerce_test(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_commerce_test(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.review_cancelled_salon_sale() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE salon_sales SET state='review_required' WHERE appointment_id=NEW.id
   OR id IN(SELECT sale_id FROM salon_sale_appointments WHERE appointment_id=NEW.id);
 END IF;
 RETURN NEW;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
