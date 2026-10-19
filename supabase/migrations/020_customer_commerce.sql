BEGIN;
-- All monetary operations are server-only, TEST-only and serialized per salon.
CREATE TABLE commerce_settings (
 salon_id uuid PRIMARY KEY REFERENCES salons(id), products_enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),salon_id uuid NOT NULL REFERENCES salons(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),sku text NOT NULL CHECK(length(sku) BETWEEN 1 AND 60),
 price_cents integer NOT NULL CHECK(price_cents BETWEEN 1 AND 1000000),vat_percent integer NOT NULL DEFAULT 22 CHECK(vat_percent IN(4,5,10,22)),
 stock integer NOT NULL DEFAULT 0 CHECK(stock>=0),minimum_stock integer NOT NULL DEFAULT 0 CHECK(minimum_stock>=0),
 active boolean NOT NULL DEFAULT true,UNIQUE(salon_id,sku)
);
CREATE TABLE loyalty_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),salon_id uuid NOT NULL REFERENCES salons(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),visits integer NOT NULL CHECK(visits BETWEEN 1 AND 100),
 percent integer NOT NULL CHECK(percent BETWEEN 1 AND 90),service_id uuid REFERENCES services(id),
 active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX loyalty_one_active ON loyalty_rules(salon_id) WHERE active;
CREATE TABLE customer_rewards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),salon_id uuid NOT NULL REFERENCES salons(id),client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 120),percent integer CHECK(percent BETWEEN 1 AND 90),
 amount_cents integer CHECK(amount_cents BETWEEN 1 AND 100000),service_id uuid REFERENCES services(id),
 rule_id uuid REFERENCES loyalty_rules(id),milestone integer,earned_appointment_id uuid REFERENCES appointments(id),
 expires_at timestamptz,used_sale_id uuid,revoked_at timestamptz,created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((percent IS NULL)<>(amount_cents IS NULL)),UNIQUE(rule_id,client_id,milestone)
);
ALTER TABLE salon_sales DROP CONSTRAINT salon_sales_appointment_id_key,ALTER COLUMN appointment_id DROP NOT NULL;
ALTER TABLE salon_sales ADD COLUMN kind text NOT NULL DEFAULT 'appointment' CHECK(kind IN('appointment','extra','retail','topup')),
 ADD COLUMN client_id uuid REFERENCES clients(id) ON DELETE RESTRICT,
 ADD COLUMN credit_cents integer NOT NULL DEFAULT 0 CHECK(credit_cents>=0),
 ADD COLUMN tender_cents integer NOT NULL DEFAULT 0 CHECK(tender_cents>=0),
 ADD COLUMN reward_id uuid REFERENCES customer_rewards(id),ADD COLUMN request_snapshot jsonb;
-- Populate new accounting columns without changing existing financial snapshots.
ALTER TABLE salon_sales DISABLE TRIGGER guard_sale_immutability;
UPDATE salon_sales SET tender_cents=amount_cents;
ALTER TABLE salon_sales ENABLE TRIGGER guard_sale_immutability;
CREATE UNIQUE INDEX salon_sale_base_unique ON salon_sales(appointment_id) WHERE kind='appointment';
ALTER TABLE customer_rewards ADD CONSTRAINT reward_sale_fk FOREIGN KEY(used_sale_id) REFERENCES salon_sales(id);
CREATE TABLE customer_credit_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),salon_id uuid NOT NULL REFERENCES salons(id),client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 sale_id uuid NOT NULL REFERENCES salon_sales(id),delta_cents integer NOT NULL CHECK(delta_cents<>0),
 kind text NOT NULL CHECK(kind IN('topup','spend','reversal')),created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(sale_id,kind)
);
CREATE INDEX credit_client ON customer_credit_movements(salon_id,client_id);
CREATE TABLE stock_movements (
 id uuid PRIMARY KEY,salon_id uuid NOT NULL REFERENCES salons(id),product_id uuid NOT NULL REFERENCES products(id),
 sale_id uuid REFERENCES salon_sales(id),quantity integer NOT NULL CHECK(quantity<>0),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sale_reversals (
 sale_id uuid PRIMARY KEY REFERENCES salon_sales(id),salon_id uuid NOT NULL REFERENCES salons(id),request_id uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),reason text NOT NULL,restock boolean NOT NULL,
 returned_cents integer NOT NULL,document_id uuid REFERENCES fiscal_documents(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION commerce_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_LEDGER';END $$;
CREATE TRIGGER credit_immutable BEFORE UPDATE OR DELETE ON customer_credit_movements FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
CREATE TRIGGER stock_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
CREATE TRIGGER reversal_immutable BEFORE UPDATE OR DELETE ON sale_reversals FOR EACH ROW EXECUTE FUNCTION commerce_immutable();
CREATE OR REPLACE FUNCTION guard_sale_document() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.sale_id IS DISTINCT FROM OLD.sale_id THEN RAISE EXCEPTION 'IMMUTABLE_SALE_LINK';END IF;
 IF NEW.sale_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM salon_sales WHERE id=NEW.sale_id AND salon_id=NEW.salon_id AND appointment_id IS NOT DISTINCT FROM NEW.appointment_id AND amount_cents=NEW.amount_cents AND mode=NEW.mode) THEN RAISE EXCEPTION 'SALE_DOCUMENT_MISMATCH';END IF;
 RETURN NEW;
END $$;
-- Permission check used also inside RPCs: a posted salon/actor is never enough.
CREATE FUNCTION commerce_staff(p_salon uuid,p_actor uuid,p_manager boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_actor AND salon_id=p_salon AND role::text IN('owner','admin','receptionist') AND (NOT p_manager OR role::text IN('owner','admin'))) THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
END $$;
CREATE FUNCTION commerce_balance(p_salon uuid,p_client uuid) RETURNS integer LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT coalesce(sum(delta_cents),0)::integer FROM customer_credit_movements WHERE salon_id=p_salon AND client_id=p_client
$$;
-- SIGN IT lite single-purpose TEST vouchers: VAT at issuance. The redemption
-- representation follows fiskaly's 2026-06-01 guide. Fully covered lines use
-- its one-cent payment-discount workaround; never enabled in LIVE.
CREATE FUNCTION commerce_receipt(p_lines jsonb,p_credit integer,p_method text,p_number text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE item jsonb;gross integer;remaining integer:=p_credit;used integer;net integer;rate integer;
 inclusive integer:=0;exclusive integer:=0;adjustment integer:=0;line_adjust integer;
 entries jsonb:='[]';groups jsonb:='{}';g jsonb;vat jsonb;pay jsonb;breakdown jsonb;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  gross:=(item->>'quantity')::integer*(item->>'unitPriceCents')::integer-(item->>'discountCents')::integer;
  IF gross=0 THEN CONTINUE;END IF;
  rate:=(item->>'vatPercent')::integer;used:=least(gross,remaining);remaining:=remaining-used;
  IF used>0 AND rate<>22 THEN RAISE EXCEPTION 'CREDIT_VAT_MISMATCH';END IF;
  line_adjust:=CASE WHEN gross=used THEN 1 ELSE 0 END;adjustment:=adjustment+line_adjust;
  net:=round((gross-used+line_adjust)*100.0/(100+rate));
  vat:=jsonb_build_object('type','VAT_RATE','code',CASE rate WHEN 22 THEN 'STANDARD' WHEN 10 THEN 'REDUCED_1' WHEN 5 THEN 'REDUCED_2' ELSE 'REDUCED_3' END,'percentage',to_char(rate,'FM990.00'),
   'exclusive',to_char(net/100.0,'FM999999990.00'),'inclusive',to_char((gross-used+line_adjust)/100.0,'FM999999990.00'),'amount',to_char((gross-used+line_adjust-net)/100.0,'FM999999990.00'));
  entries:=entries||jsonb_build_array(jsonb_build_object('type','SALE','details',jsonb_build_object('concept',CASE WHEN item->>'kind'='service' THEN 'SERVICE' ELSE 'GOOD' END),
   'data',jsonb_build_object('type','ITEM','text',left((item->>'quantity')||' x '||(item->>'description')||CASE WHEN used>0 THEN ' - utilizzo credito prepagato TEST' ELSE '' END,250),
   'unit',jsonb_build_object('quantity','1.00','price',jsonb_build_object('inclusive',to_char((gross+line_adjust)/100.0,'FM999999990.00'),'exclusive',to_char(round((gross+line_adjust)*100.0/(100+rate))/100.0,'FM999999990.00'))),
   'value',jsonb_build_object('base',to_char(round((gross+line_adjust)*100.0/(100+rate))/100.0,'FM999999990.00'),'discount',to_char(used/100.0,'FM999999990.00')),'vat',vat)));
  inclusive:=inclusive+gross-used+line_adjust;exclusive:=exclusive+net;
  g:=coalesce(groups->rate::text,'{"net":0,"gross":0}');
  groups:=jsonb_set(groups,ARRAY[rate::text],jsonb_build_object('net',(g->>'net')::integer+net,'gross',(g->>'gross')::integer+gross-used+line_adjust));
 END LOOP;
 IF remaining<>0 OR jsonb_array_length(entries)=0 THEN RAISE EXCEPTION 'INVALID_CREDIT';END IF;
 SELECT jsonb_agg(jsonb_build_object('type','VAT_RATE','code',CASE key WHEN '22' THEN 'STANDARD' WHEN '10' THEN 'REDUCED_1' WHEN '5' THEN 'REDUCED_2' ELSE 'REDUCED_3' END,'percentage',to_char(key::integer,'FM990.00'),
 'exclusive',to_char((value->>'net')::numeric/100,'FM999999990.00'),'inclusive',to_char((value->>'gross')::numeric/100,'FM999999990.00'),'amount',to_char(((value->>'gross')::numeric-(value->>'net')::numeric)/100,'FM999999990.00')) ORDER BY key) INTO breakdown FROM jsonb_each(groups);
 pay:=jsonb_build_object('type',CASE WHEN p_method='cash' THEN 'CASH' ELSE 'CARD' END,'details',jsonb_build_object('amount',to_char((inclusive-adjustment)/100.0,'FM999999990.00')));
 IF p_method='card' THEN pay:=pay||jsonb_build_object('kind','CREDIT','number','****');END IF;
 IF adjustment>0 THEN pay:=jsonb_set(pay,'{details,discount}',to_jsonb(to_char(adjustment/100.0,'FM999999990.00')));END IF;
 RETURN jsonb_build_object('type','RECEIPT','document',jsonb_build_object('number',p_number),'entries',entries,'breakdown',breakdown,
 'totals',jsonb_build_object('vat',jsonb_build_object('inclusive',to_char(inclusive/100.0,'FM999999990.00'),'exclusive',to_char(exclusive/100.0,'FM999999990.00'),'amount',to_char((inclusive-exclusive)/100.0,'FM999999990.00'))),'payments',jsonb_build_array(pay));
END $$;
CREATE FUNCTION register_commerce_test(p_salon uuid,p_actor uuid,p_input jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public AS $$
DECLARE key uuid:=(p_input->>'requestId')::uuid;kind text:=p_input->>'kind';aid uuid:=nullif(p_input->>'appointmentId','')::uuid;cid uuid:=nullif(p_input->>'clientId','')::uuid;
 credit integer:=coalesce((p_input->>'creditCents')::integer,0);method text:=p_input->>'method';rid uuid:=nullif(p_input->>'rewardId','')::uuid;
 a appointments%ROWTYPE;s salon_sales%ROWTYPE;c clients%ROWTYPE;cfg fiscal_configs%ROWTYPE;r customer_rewards%ROWTYPE;q appointment_quotes%ROWTYPE;prod products%ROWTYPE;
 item jsonb;lines jsonb:='[]';total integer;idx integer:=0;best integer:=-1;bestgross integer:=0;discount integer:=0;gross integer;doc uuid;op jsonb;snap jsonb;cnt integer;
BEGIN
 PERFORM commerce_staff(p_salon,p_actor);PERFORM pg_advisory_xact_lock(hashtextextended('commerce:'||p_salon::text,0));
 IF key IS NULL OR p_input->>'confirmed' IS DISTINCT FROM 'true' OR kind IS NULL OR kind NOT IN('appointment','extra','retail','topup') OR method IS NULL OR method NOT IN('cash','card') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 SELECT * INTO s FROM salon_sales WHERE id=key;
 IF FOUND THEN
  IF s.salon_id<>p_salon OR s.request_snapshot IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'CONFLICTING_REQUEST';END IF;
  SELECT id INTO doc FROM fiscal_documents WHERE sale_id=key AND operation='receipt';RETURN doc;
 END IF;
 SELECT * INTO cfg FROM fiscal_configs WHERE salon_id=p_salon AND provider='fiskaly' AND enabled FOR SHARE;
 IF NOT FOUND OR cfg.mode<>'test' OR cfg.system_id IS NULL OR cfg.organization_id IS NULL OR cfg.taxpayer_id IS NULL OR cfg.location_id IS NULL THEN RAISE EXCEPTION 'TEST_CONFIG_REQUIRED';END IF;
 IF aid IS NOT NULL THEN
  SELECT * INTO a FROM appointments WHERE id=aid AND salon_id=p_salon FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND';END IF;
  IF a.status::text NOT IN('confirmed','completed') THEN RAISE EXCEPTION 'APPOINTMENT_CLOSED';END IF;
  IF a.updated_at IS DISTINCT FROM (p_input->>'expectedUpdate')::timestamptz OR a.client_id IS DISTINCT FROM cid THEN RAISE EXCEPTION 'STALE_APPOINTMENT';END IF;
 ELSIF kind IN('appointment','extra') THEN RAISE EXCEPTION 'APPOINTMENT_NOT_FOUND';END IF;
 IF kind IN('retail','topup') AND aid IS NOT NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF cid IS NOT NULL THEN
  SELECT * INTO c FROM clients WHERE id=cid AND salon_id=p_salon FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND';END IF;
 END IF;
 IF kind='appointment' AND (EXISTS(SELECT 1 FROM salon_sales existing WHERE existing.appointment_id=aid AND existing.kind='appointment') OR EXISTS(SELECT 1 FROM payments WHERE appointment_id=aid AND status IN('pending','authorized','succeeded','refunded','partially_refunded')) OR EXISTS(SELECT 1 FROM fiscal_documents WHERE appointment_id=aid AND sale_id IS NULL AND operation='receipt')) THEN RAISE EXCEPTION 'ALREADY_PAID';END IF;
 PERFORM checkout_basket_total(p_input->'lines');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'lines') l WHERE (l->>'discountCents')::integer >= (l->>'quantity')::integer*(l->>'unitPriceCents')::integer) THEN RAISE EXCEPTION 'INVALID_DISCOUNT';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_input->'lines') LOOP
  IF item->>'kind'='product' THEN
   IF NOT coalesce((SELECT products_enabled FROM commerce_settings WHERE salon_id=p_salon),false) THEN RAISE EXCEPTION 'PRODUCTS_DISABLED';END IF;
   SELECT * INTO prod FROM products WHERE id=(item->>'id')::uuid AND salon_id=p_salon AND active FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND';END IF;
   IF (item->>'unitPriceCents')::integer<>prod.price_cents THEN RAISE EXCEPTION 'PRICE_CHANGED';END IF;
   item:=item||jsonb_build_object('description',prod.name,'vatPercent',prod.vat_percent);
  ELSIF item->>'kind'='service' THEN
   IF kind IN('topup','retail','extra') THEN RAISE EXCEPTION 'INVALID_LINE_KIND';END IF;
   IF item->>'id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM services WHERE id=(item->>'id')::uuid AND salon_id=p_salon) THEN RAISE EXCEPTION 'SERVICE_NOT_FOUND';END IF;
   item:=item||jsonb_build_object('vatPercent',22);
  ELSIF item->>'kind'='topup' AND kind='topup' AND jsonb_array_length(p_input->'lines')=1 AND (item->>'quantity')::integer=1 AND (item->>'discountCents')::integer=0 THEN
   item:=item||jsonb_build_object('description','Credito prepagato nominativo TEST','vatPercent',22);
  ELSE RAISE EXCEPTION 'INVALID_LINE_KIND';END IF;
  IF kind='topup' AND item->>'kind'<>'topup' THEN RAISE EXCEPTION 'INVALID_LINE_KIND';END IF;
  lines:=lines||jsonb_build_array(item);
 END LOOP;
 IF kind='topup' AND (cid IS NULL OR credit<>0 OR rid IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_TOPUP';END IF;
 IF rid IS NOT NULL THEN
  SELECT * INTO r FROM customer_rewards WHERE id=rid AND salon_id=p_salon AND client_id=cid FOR UPDATE;
  IF NOT FOUND OR r.used_sale_id IS NOT NULL OR r.revoked_at IS NOT NULL OR r.expires_at<=now() OR r.earned_appointment_id=aid THEN RAISE EXCEPTION 'REWARD_UNAVAILABLE';END IF;
  IF r.earned_appointment_id IS NOT NULL AND a.start_time<=(SELECT end_time FROM appointments WHERE id=r.earned_appointment_id) THEN RAISE EXCEPTION 'REWARD_UNAVAILABLE';END IF;
  IF r.rule_id IS NOT NULL THEN
   SELECT count(*) INTO cnt FROM appointments ap JOIN loyalty_rules lr ON lr.id=r.rule_id WHERE ap.salon_id=p_salon AND ap.client_id=cid AND ap.status::text='completed' AND ap.end_time<=now() AND ap.start_time>=lr.created_at AND (lr.service_id IS NULL OR ap.service_id=lr.service_id);
   IF cnt<(SELECT visits FROM loyalty_rules WHERE id=r.rule_id)*r.milestone THEN RAISE EXCEPTION 'REWARD_UNAVAILABLE';END IF;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(lines) LOOP
   IF (item->>'discountCents')::integer<>0 THEN RAISE EXCEPTION 'REWARD_NOT_STACKABLE';END IF;
   gross:=(item->>'quantity')::integer*(item->>'unitPriceCents')::integer;
   IF item->>'kind'='service' AND (r.service_id IS NULL OR item->>'id'=r.service_id::text) AND gross>bestgross THEN best:=idx;bestgross:=gross;END IF;idx:=idx+1;
  END LOOP;
  IF best<0 THEN RAISE EXCEPTION 'REWARD_SERVICE_MISMATCH';END IF;
  discount:=least(bestgross-1,coalesce(r.amount_cents,round(bestgross*r.percent/100.0)::integer));
  IF discount<=0 THEN RAISE EXCEPTION 'REWARD_UNAVAILABLE';END IF;
  lines:=jsonb_set(lines,ARRAY[best::text,'discountCents'],to_jsonb(discount));
 END IF;
 total:=checkout_basket_total(lines);
 IF credit<0 OR credit>total OR credit>0 AND (cid IS NULL OR commerce_balance(p_salon,cid)<credit) THEN RAISE EXCEPTION 'INSUFFICIENT_CREDIT';END IF;
 IF credit>0 AND EXISTS(SELECT 1 FROM jsonb_array_elements(lines) l WHERE (l->>'vatPercent')::integer<>22) THEN RAISE EXCEPTION 'CREDIT_VAT_MISMATCH';END IF;
 IF p_input->>'quoteId' IS NOT NULL THEN
  SELECT * INTO q FROM appointment_quotes WHERE id=(p_input->>'quoteId')::uuid AND salon_id=p_salon AND appointment_id=aid FOR UPDATE;
  IF NOT FOUND OR q.status<>'draft' OR q.version IS DISTINCT FROM (p_input->>'quoteVersion')::integer OR q.valid_until<current_date OR q.snapshot->>'clientId' IS DISTINCT FROM cid::text THEN RAISE EXCEPTION 'STALE_QUOTE';END IF;
  -- Conversion keeps the saved quote amounts; promotions require a new quote.
  IF rid IS NOT NULL OR (SELECT jsonb_agg(value-'kind'-'id'-'vatPercent') FROM jsonb_array_elements(p_input->'lines')) IS DISTINCT FROM q.snapshot->'lines' THEN RAISE EXCEPTION 'STALE_QUOTE';END IF;
 END IF;
 snap:=jsonb_build_object('clientId',cid,'clientName',coalesce(c.first_name||' '||c.last_name,'Cliente occasionale'),'lines',lines,'creditCents',credit,'tenderCents',total-credit,'promotionDiscountCents',discount,'rewardLabel',r.label,'fiscalPolicy','TEST_SPV_22');
 INSERT INTO salon_sales(id,salon_id,appointment_id,created_by,amount_cents,payment_method,mode,snapshot,kind,client_id,credit_cents,tender_cents,reward_id,request_snapshot,quote_id,quote_version)
 VALUES(key,p_salon,aid,p_actor,total,method,'test',snap,kind,cid,credit,total-credit,rid,p_input,q.id,q.version);
 IF kind='topup' OR credit>0 THEN INSERT INTO customer_credit_movements(salon_id,client_id,sale_id,delta_cents,kind,created_by) VALUES(p_salon,cid,key,CASE WHEN kind='topup' THEN total ELSE -credit END,CASE WHEN kind='topup' THEN 'topup' ELSE 'spend' END,p_actor);END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(lines) WHERE value->>'kind'='product' LOOP
  UPDATE products SET stock=stock-(item->>'quantity')::integer WHERE id=(item->>'id')::uuid AND salon_id=p_salon AND stock>=(item->>'quantity')::integer;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK';END IF;
  INSERT INTO stock_movements VALUES(gen_random_uuid(),p_salon,(item->>'id')::uuid,key,-(item->>'quantity')::integer,'Vendita',p_actor,now());
 END LOOP;
 IF rid IS NOT NULL THEN UPDATE customer_rewards SET used_sale_id=key WHERE id=rid;END IF;
 IF q.id IS NOT NULL THEN UPDATE appointment_quotes SET status='converted',version=version+1,updated_at=now() WHERE id=q.id;END IF;
 op:=commerce_receipt(lines,credit,method,'TEST-'||upper(substr(replace(key::text,'-',''),1,15)));
 INSERT INTO fiscal_documents(salon_id,appointment_id,sale_id,provider,mode,amount_cents,operation_snapshot,configuration_snapshot)
 VALUES(p_salon,aid,key,'fiskaly','test',total,op,jsonb_build_object('provider','fiskaly','mode','test','organization_id',cfg.organization_id,'taxpayer_id',cfg.taxpayer_id,'location_id',cfg.location_id,'system_id',cfg.system_id)) RETURNING id INTO doc;
 INSERT INTO fiscal_jobs(salon_id,document_id) VALUES(p_salon,doc);RETURN doc;
END $$;
-- Rewards are earned by completed visits after activation, never by a booking/payment alone.
CREATE FUNCTION earn_visit_reward() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r loyalty_rules%ROWTYPE;cnt integer;n integer;
BEGIN
 IF NEW.status::text<>'completed' OR NEW.client_id IS NULL OR NEW.end_time>now() THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('loyalty:'||NEW.salon_id::text||NEW.client_id::text,0));
 FOR r IN SELECT * FROM loyalty_rules WHERE salon_id=NEW.salon_id AND active AND NEW.start_time>=created_at AND (service_id IS NULL OR service_id=NEW.service_id) LOOP
  SELECT count(*) INTO cnt FROM appointments WHERE salon_id=NEW.salon_id AND client_id=NEW.client_id AND status::text='completed' AND end_time<=now() AND start_time>=r.created_at AND (r.service_id IS NULL OR service_id=r.service_id);
  FOR n IN 1..(cnt/r.visits) LOOP
   INSERT INTO customer_rewards(salon_id,client_id,label,percent,service_id,rule_id,milestone,earned_appointment_id)
   VALUES(NEW.salon_id,NEW.client_id,r.name,r.percent,r.service_id,r.id,n,NEW.id) ON CONFLICT(rule_id,client_id,milestone) DO NOTHING;
  END LOOP;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER earn_visit_reward AFTER INSERT OR UPDATE OF status,client_id,end_time ON appointments FOR EACH ROW EXECUTE FUNCTION earn_visit_reward();
DO $$ DECLARE t text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['commerce_settings','products','loyalty_rules','customer_rewards','customer_credit_movements','stock_movements','sale_reversals'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON %I FROM anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON %I TO authenticated',t);
  EXECUTE format('GRANT ALL ON %I TO service_role',t);
  EXECUTE format('CREATE POLICY salon_read ON %I FOR SELECT TO authenticated USING(salon_id=get_user_salon_id())',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('commerce_staff','commerce_balance','commerce_receipt','register_commerce_test','earn_visit_reward') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
 END LOOP;
END $$;

CREATE TABLE commerce_commands(id uuid PRIMARY KEY,salon_id uuid NOT NULL REFERENCES salons(id),input jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE commerce_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON commerce_commands FROM anon,authenticated;GRANT ALL ON commerce_commands TO service_role;
CREATE FUNCTION manage_commerce(p_salon uuid,p_actor uuid,p_input jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public AS $$
DECLARE key uuid:=(p_input->>'requestId')::uuid;action text:=p_input->>'action';prior commerce_commands%ROWTYPE;pid uuid;cid uuid;sid uuid;qty integer;
 s salon_sales%ROWTYPE;d fiscal_documents%ROWTYPE;reversal sale_reversals%ROWTYPE;doc uuid;item jsonb;
BEGIN
 PERFORM commerce_staff(p_salon,p_actor,true);PERFORM pg_advisory_xact_lock(hashtextextended('commerce:'||p_salon::text,0));
 IF key IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 SELECT * INTO prior FROM commerce_commands WHERE id=key;
 IF FOUND THEN
  IF prior.salon_id<>p_salon OR prior.input IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'CONFLICTING_REQUEST';END IF;RETURN key;
 END IF;
 IF action='settings' THEN
  IF jsonb_typeof(p_input->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  INSERT INTO commerce_settings(salon_id,products_enabled) VALUES(p_salon,(p_input->>'enabled')::boolean) ON CONFLICT(salon_id) DO UPDATE SET products_enabled=EXCLUDED.products_enabled;
 ELSIF action='product' THEN
  pid:=coalesce(nullif(p_input->>'id','')::uuid,key);
  IF EXISTS(SELECT 1 FROM products WHERE id=pid AND salon_id<>p_salon) THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
  INSERT INTO products(id,salon_id,name,sku,price_cents,vat_percent,minimum_stock,active)
  VALUES(pid,p_salon,trim(p_input->>'name'),trim(p_input->>'sku'),(p_input->>'priceCents')::integer,(p_input->>'vatPercent')::integer,(p_input->>'minimumStock')::integer,(p_input->>'active')::boolean)
  ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,sku=EXCLUDED.sku,price_cents=EXCLUDED.price_cents,vat_percent=EXCLUDED.vat_percent,minimum_stock=EXCLUDED.minimum_stock,active=EXCLUDED.active;
 ELSIF action='stock' THEN
  pid:=(p_input->>'productId')::uuid;qty:=(p_input->>'quantity')::integer;
  IF qty IS NULL OR qty=0 OR abs(qty)>100000 OR length(trim(coalesce(p_input->>'reason',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  UPDATE products SET stock=stock+qty WHERE id=pid AND salon_id=p_salon AND stock+qty>=0;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK';END IF;
  INSERT INTO stock_movements VALUES(key,p_salon,pid,NULL,qty,trim(p_input->>'reason'),p_actor,now());
 ELSIF action IN('rule','reward') THEN
  sid:=nullif(p_input->>'serviceId','')::uuid;
  IF sid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM services WHERE id=sid AND salon_id=p_salon) THEN RAISE EXCEPTION 'SERVICE_NOT_FOUND';END IF;
  IF action='rule' THEN
   UPDATE loyalty_rules SET active=false WHERE salon_id=p_salon AND active;
   IF p_input->>'enabled'='true' THEN INSERT INTO loyalty_rules(id,salon_id,name,visits,percent,service_id) VALUES(key,p_salon,p_input->>'name',(p_input->>'visits')::integer,(p_input->>'percent')::integer,sid);END IF;
  ELSE
   cid:=(p_input->>'clientId')::uuid;
   IF NOT EXISTS(SELECT 1 FROM clients WHERE id=cid AND salon_id=p_salon) THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND';END IF;
   IF p_input->>'expiresAt' IS NOT NULL AND (p_input->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'INVALID_EXPIRY';END IF;
   INSERT INTO customer_rewards(id,salon_id,client_id,label,percent,amount_cents,service_id,expires_at,created_by)
   VALUES(key,p_salon,cid,p_input->>'label',(p_input->>'percent')::integer,(p_input->>'amountCents')::integer,sid,(p_input->>'expiresAt')::timestamptz,p_actor);
  END IF;
 ELSIF action='revokeReward' THEN
  UPDATE customer_rewards SET revoked_at=now() WHERE id=(p_input->>'rewardId')::uuid AND salon_id=p_salon AND used_sale_id IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'REWARD_UNAVAILABLE';END IF;
 ELSIF action='reverse' THEN
  SELECT * INTO s FROM salon_sales WHERE id=(p_input->>'saleId')::uuid AND salon_id=p_salon FOR UPDATE;
  IF NOT FOUND OR s.mode<>'test' OR s.request_snapshot IS NULL THEN RAISE EXCEPTION 'SALE_NOT_REVERSIBLE';END IF;
  IF p_input->>'confirmed' IS DISTINCT FROM 'true' OR jsonb_typeof(p_input->'restock') IS DISTINCT FROM 'boolean' OR length(trim(coalesce(p_input->>'reason',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  IF EXISTS(SELECT 1 FROM sale_reversals WHERE sale_id=s.id) THEN RAISE EXCEPTION 'ALREADY_REVERSED';END IF;
  SELECT * INTO d FROM fiscal_documents WHERE sale_id=s.id AND operation='receipt' FOR UPDATE;
  IF NOT FOUND OR d.processing_status<>'completed' OR d.provider_record_id IS NULL OR d.status='canceled' THEN RAISE EXCEPTION 'FISCAL_NOT_READY';END IF;
  IF (s.created_at AT TIME ZONE 'Europe/Rome')::date<>(now() AT TIME ZONE 'Europe/Rome')::date THEN RAISE EXCEPTION 'RETURN_REQUIRES_REVIEW';END IF;
  IF s.kind='topup' AND commerce_balance(p_salon,s.client_id)<s.amount_cents THEN RAISE EXCEPTION 'CREDIT_ALREADY_SPENT';END IF;
  IF s.kind='topup' OR s.credit_cents>0 THEN INSERT INTO customer_credit_movements(salon_id,client_id,sale_id,delta_cents,kind,created_by) VALUES(p_salon,s.client_id,s.id,CASE WHEN s.kind='topup' THEN -s.amount_cents ELSE s.credit_cents END,'reversal',p_actor);END IF;
  IF (p_input->>'restock')::boolean THEN
   FOR item IN SELECT value FROM jsonb_array_elements(s.snapshot->'lines') WHERE value->>'kind'='product' LOOP
    UPDATE products SET stock=stock+(item->>'quantity')::integer WHERE id=(item->>'id')::uuid AND salon_id=p_salon;
    INSERT INTO stock_movements VALUES(gen_random_uuid(),p_salon,(item->>'id')::uuid,s.id,(item->>'quantity')::integer,'Reso: '||left(p_input->>'reason',190),p_actor,now());
   END LOOP;
  END IF;
  -- The used promotion remains in history and can be reissued explicitly by a manager.
  INSERT INTO fiscal_documents(salon_id,appointment_id,sale_id,provider,mode,amount_cents,operation,doc_type,original_document_id,operation_snapshot,configuration_snapshot)
  VALUES(p_salon,s.appointment_id,s.id,'fiskaly','test',s.amount_cents,'cancellation','storno',d.id,jsonb_build_object('type','CANCELLATION','record',jsonb_build_object('id',d.provider_record_id)),d.configuration_snapshot) RETURNING id INTO doc;
  INSERT INTO fiscal_jobs(salon_id,document_id) VALUES(p_salon,doc);
  INSERT INTO sale_reversals VALUES(s.id,p_salon,key,p_actor,p_input->>'reason',(p_input->>'restock')::boolean,s.tender_cents,doc,now());
  UPDATE salon_sales SET state='review_required' WHERE id=s.id;
 ELSE RAISE EXCEPTION 'INVALID_ACTION';END IF;
 INSERT INTO commerce_commands VALUES(key,p_salon,p_input,p_actor,now());RETURN key;
END $$;
REVOKE ALL ON FUNCTION manage_commerce(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION manage_commerce(uuid,uuid,jsonb) TO service_role;


CREATE FUNCTION commerce_summary(p_salon uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_actor AND salon_id=p_salon) THEN RAISE EXCEPTION 'NOT_AUTHORIZED';END IF;
 SELECT jsonb_build_object('creditOutstanding',(SELECT coalesce(sum(delta_cents),0) FROM customer_credit_movements WHERE salon_id=p_salon),
 'cashReceived',(SELECT coalesce(sum(tender_cents),0) FROM salon_sales WHERE salon_id=p_salon)-(SELECT coalesce(sum(returned_cents),0) FROM sale_reversals WHERE salon_id=p_salon),
 'creditUsed',(SELECT coalesce(sum(s.credit_cents),0) FROM salon_sales s WHERE salon_id=p_salon AND NOT EXISTS(SELECT 1 FROM sale_reversals r WHERE r.sale_id=s.id))) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION commerce_summary(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION commerce_summary(uuid,uuid) TO service_role;

CREATE FUNCTION set_legacy_sale_tender() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.request_snapshot IS NULL THEN NEW.tender_cents:=NEW.amount_cents;END IF;RETURN NEW;END $$;
CREATE TRIGGER set_legacy_sale_tender BEFORE INSERT ON salon_sales FOR EACH ROW EXECUTE FUNCTION set_legacy_sale_tender();
COMMIT;
