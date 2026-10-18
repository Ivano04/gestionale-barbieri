BEGIN;
CREATE TABLE public.appointment_quotes (
 id uuid PRIMARY KEY, number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE RESTRICT,
 appointment_id uuid NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES public.users(id), version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','converted')),
 snapshot jsonb NOT NULL, amount_cents integer NOT NULL CHECK(amount_cents>0), valid_until date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.salon_sales (
 id uuid PRIMARY KEY, salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE RESTRICT,
 appointment_id uuid NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE RESTRICT,
 quote_version integer, quote_id uuid UNIQUE REFERENCES public.appointment_quotes(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES public.users(id), amount_cents integer NOT NULL CHECK(amount_cents>0),
 payment_method text NOT NULL CHECK(payment_method IN ('cash','card')), mode provider_mode NOT NULL CHECK(mode='test'),
 state text NOT NULL DEFAULT 'recorded' CHECK(state IN ('recorded','review_required')),
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fiscal_documents ADD COLUMN sale_id uuid REFERENCES public.salon_sales(id) ON DELETE RESTRICT,
 ADD CONSTRAINT fiscal_document_one_payment_source CHECK(sale_id IS NULL OR payment_id IS NULL);
CREATE UNIQUE INDEX fiscal_receipt_sale_unique ON public.fiscal_documents(sale_id) WHERE operation='receipt';
ALTER TABLE public.appointment_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_quotes, public.salon_sales FROM anon,authenticated;
GRANT SELECT ON public.appointment_quotes,public.salon_sales TO authenticated;
GRANT ALL ON public.appointment_quotes,public.salon_sales TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.appointment_quotes_number_seq TO service_role;
CREATE POLICY quotes_read_salon ON public.appointment_quotes FOR SELECT TO authenticated USING(salon_id=get_user_salon_id());
CREATE POLICY sales_read_salon ON public.salon_sales FOR SELECT TO authenticated USING(salon_id=get_user_salon_id());
CREATE FUNCTION public.checkout_basket_total(p_lines jsonb) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE item jsonb;qty numeric;price numeric;discount numeric;total numeric:=0;
BEGIN
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'INVALID_BASKET';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF jsonb_typeof(item->'description') IS DISTINCT FROM 'string' OR length(trim(item->>'description')) NOT BETWEEN 1 AND 120
   OR coalesce(item->>'quantity','') !~ '^[0-9]+$' OR coalesce(item->>'unitPriceCents','') !~ '^[0-9]+$' OR coalesce(item->>'discountCents','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'INVALID_BASKET';END IF;
  qty:=(item->>'quantity')::numeric;price:=(item->>'unitPriceCents')::numeric;discount:=(item->>'discountCents')::numeric;
  IF qty NOT BETWEEN 1 AND 99 OR price NOT BETWEEN 0 AND 1000000 OR discount NOT BETWEEN 0 AND qty*price THEN RAISE EXCEPTION 'INVALID_BASKET';END IF;
  total:=total+qty*price-discount;
 END LOOP;
 IF total NOT BETWEEN 1 AND 10000000 THEN RAISE EXCEPTION 'INVALID_TOTAL';END IF;
 RETURN total::integer;
END $$;
CREATE FUNCTION public.save_appointment_quote(p_id uuid,p_salon uuid,p_appointment uuid,p_actor uuid,p_version integer,p_expected_update timestamptz,p_snapshot jsonb,p_valid_until date)
RETURNS uuid LANGUAGE plpgsql SET search_path=public AS $$
DECLARE a appointments%ROWTYPE;q appointment_quotes%ROWTYPE;total integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_actor AND salon_id=p_salon) THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
 SELECT * INTO a FROM appointments WHERE id=p_appointment AND salon_id=p_salon FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND';END IF;
 IF a.status NOT IN ('confirmed','completed') THEN RAISE EXCEPTION 'APPOINTMENT_CLOSED';END IF;
 IF a.updated_at IS DISTINCT FROM p_expected_update THEN RAISE EXCEPTION 'STALE_APPOINTMENT';END IF;
 IF p_version IS NULL OR p_version<0 THEN RAISE EXCEPTION 'STALE_QUOTE';END IF;
 total:=checkout_basket_total(p_snapshot->'lines');
 IF p_valid_until IS NULL OR p_valid_until<(now() AT TIME ZONE 'Europe/Rome')::date OR p_valid_until>(now()+interval '2 years')::date THEN RAISE EXCEPTION 'INVALID_EXPIRY';END IF;
 SELECT * INTO q FROM appointment_quotes WHERE appointment_id=a.id FOR UPDATE;
 IF FOUND THEN
  IF q.id=p_id AND q.version=p_version+1 AND q.status='draft' AND q.snapshot=p_snapshot AND q.valid_until=p_valid_until THEN RETURN p_id;END IF;
  IF q.id<>p_id OR q.version<>p_version OR q.status<>'draft' THEN RAISE EXCEPTION 'STALE_QUOTE';END IF;
  UPDATE appointment_quotes SET snapshot=p_snapshot,amount_cents=total,valid_until=p_valid_until,version=version+1,updated_at=now() WHERE id=q.id;
 ELSE
  IF p_version<>0 THEN RAISE EXCEPTION 'STALE_QUOTE';END IF;
  INSERT INTO appointment_quotes(id,salon_id,appointment_id,created_by,snapshot,amount_cents,valid_until) VALUES(p_id,p_salon,a.id,p_actor,p_snapshot,total,p_valid_until);
 END IF;
 RETURN p_id;
END $$;
CREATE FUNCTION public.register_salon_sale_test(p_id uuid,p_salon uuid,p_appointment uuid,p_actor uuid,p_expected_update timestamptz,p_snapshot jsonb,p_method text,p_operation jsonb,p_quote_id uuid DEFAULT NULL,p_quote_version integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path=public AS $$
DECLARE a appointments%ROWTYPE;sale salon_sales%ROWTYPE;q appointment_quotes%ROWTYPE;cfg fiscal_configs%ROWTYPE;total integer;document_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_actor AND salon_id=p_salon) THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
 SELECT * INTO a FROM appointments WHERE id=p_appointment AND salon_id=p_salon FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND';END IF;
 SELECT * INTO sale FROM salon_sales WHERE id=p_id;
 IF FOUND THEN
  IF sale.appointment_id<>a.id OR sale.salon_id<>p_salon OR sale.snapshot IS DISTINCT FROM p_snapshot OR sale.payment_method IS DISTINCT FROM p_method OR sale.quote_id IS DISTINCT FROM p_quote_id OR sale.quote_version IS DISTINCT FROM p_quote_version THEN RAISE EXCEPTION 'CONFLICTING_REQUEST';END IF;
  SELECT id INTO document_id FROM fiscal_documents WHERE sale_id=sale.id AND operation='receipt';RETURN document_id;
 END IF;
 IF a.status NOT IN ('confirmed','completed') THEN RAISE EXCEPTION 'APPOINTMENT_CLOSED';END IF;
 IF a.updated_at IS DISTINCT FROM p_expected_update THEN RAISE EXCEPTION 'STALE_APPOINTMENT';END IF;
 IF EXISTS(SELECT 1 FROM salon_sales WHERE appointment_id=a.id) OR EXISTS(SELECT 1 FROM fiscal_documents WHERE appointment_id=a.id AND operation='receipt')
 OR EXISTS(SELECT 1 FROM payments WHERE appointment_id=a.id AND (status IN ('pending','authorized','succeeded','refunded','partially_refunded'))) THEN RAISE EXCEPTION 'ALREADY_PAID';END IF;
 IF p_method IS NULL OR p_method NOT IN ('cash','card') THEN RAISE EXCEPTION 'INVALID_METHOD';END IF;
 total:=checkout_basket_total(p_snapshot->'lines');
 IF p_operation->>'type' IS DISTINCT FROM 'RECEIPT' OR (p_operation#>>'{totals,vat,inclusive}')::numeric*100 IS DISTINCT FROM total::numeric
 OR (p_operation#>>'{payments,0,type}') IS DISTINCT FROM (CASE WHEN p_method='cash' THEN 'CASH' ELSE 'CARD' END) THEN RAISE EXCEPTION 'INVALID_RECEIPT';END IF;
 IF p_quote_id IS NOT NULL THEN
  SELECT * INTO q FROM appointment_quotes WHERE id=p_quote_id AND appointment_id=a.id AND salon_id=p_salon FOR UPDATE;
  IF NOT FOUND OR q.status<>'draft' OR q.version IS DISTINCT FROM p_quote_version OR q.valid_until<(now() AT TIME ZONE 'Europe/Rome')::date
   OR q.snapshot IS DISTINCT FROM p_snapshot OR q.amount_cents<>total OR q.snapshot->>'clientId' IS DISTINCT FROM a.client_id::text THEN RAISE EXCEPTION 'STALE_QUOTE';END IF;
 END IF;
 SELECT * INTO cfg FROM fiscal_configs WHERE salon_id=p_salon AND provider='fiskaly' AND enabled FOR SHARE;
 IF NOT FOUND OR cfg.mode<>'test' OR cfg.system_id IS NULL OR cfg.organization_id IS NULL OR cfg.taxpayer_id IS NULL OR cfg.location_id IS NULL THEN RAISE EXCEPTION 'TEST_CONFIG_REQUIRED';END IF;
 INSERT INTO salon_sales(id,salon_id,appointment_id,quote_id,quote_version,created_by,amount_cents,payment_method,mode,snapshot) VALUES(p_id,p_salon,a.id,p_quote_id,p_quote_version,p_actor,total,p_method,'test',p_snapshot);
 INSERT INTO fiscal_documents(salon_id,appointment_id,sale_id,provider,mode,amount_cents,operation_snapshot,configuration_snapshot)
 VALUES(p_salon,a.id,p_id,'fiskaly','test',total,p_operation,jsonb_build_object('provider','fiskaly','mode','test','organization_id',cfg.organization_id,'taxpayer_id',cfg.taxpayer_id,'location_id',cfg.location_id,'system_id',cfg.system_id)) RETURNING id INTO document_id;
 INSERT INTO fiscal_jobs(salon_id,document_id) VALUES(p_salon,document_id);
 IF p_quote_id IS NOT NULL THEN UPDATE appointment_quotes SET status='converted',version=version+1,updated_at=now() WHERE id=p_quote_id;END IF;
 RETURN document_id;
END $$;
CREATE FUNCTION public.guard_quote_immutability() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF (NEW.id,NEW.salon_id,NEW.appointment_id,NEW.created_by,NEW.created_at,NEW.number) IS DISTINCT FROM (OLD.id,OLD.salon_id,OLD.appointment_id,OLD.created_by,OLD.created_at,OLD.number)
 OR OLD.status='converted' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'IMMUTABLE_QUOTE';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_quote_immutability BEFORE UPDATE ON public.appointment_quotes FOR EACH ROW EXECUTE FUNCTION public.guard_quote_immutability();
CREATE FUNCTION public.guard_sale_document() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.sale_id IS DISTINCT FROM OLD.sale_id THEN RAISE EXCEPTION 'IMMUTABLE_SALE_LINK';END IF;
 IF NEW.sale_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM salon_sales WHERE id=NEW.sale_id AND salon_id=NEW.salon_id AND appointment_id=NEW.appointment_id AND amount_cents=NEW.amount_cents AND mode=NEW.mode) THEN RAISE EXCEPTION 'SALE_DOCUMENT_MISMATCH';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_sale_document BEFORE INSERT OR UPDATE ON public.fiscal_documents FOR EACH ROW EXECUTE FUNCTION public.guard_sale_document();
CREATE FUNCTION public.guard_sale_immutability() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF to_jsonb(NEW)-'state' IS DISTINCT FROM to_jsonb(OLD)-'state' THEN RAISE EXCEPTION 'IMMUTABLE_SALE';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_sale_immutability BEFORE UPDATE ON public.salon_sales FOR EACH ROW EXECUTE FUNCTION public.guard_sale_immutability();
CREATE FUNCTION public.review_cancelled_salon_sale() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN UPDATE salon_sales SET state='review_required' WHERE appointment_id=NEW.id;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_cancelled_salon_sale AFTER UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.review_cancelled_salon_sale();
REVOKE ALL ON FUNCTION public.save_appointment_quote(uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.register_salon_sale_test(uuid,uuid,uuid,uuid,timestamptz,jsonb,text,jsonb,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_appointment_quote(uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_salon_sale_test(uuid,uuid,uuid,uuid,timestamptz,jsonb,text,jsonb,uuid,integer) TO service_role;
COMMIT;
