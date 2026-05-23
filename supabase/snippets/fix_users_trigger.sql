-- ============================================================
-- Fix: trigger handle_new_user + backfill utenti esistenti
-- Da eseguire nella SQL Editor di Supabase (intero script)
-- ============================================================

-- 1. Aggiorna la funzione trigger (include salon_id + role da metadata)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_salon_id uuid;
BEGIN
  BEGIN
    v_salon_id := (NEW.raw_user_meta_data->>'salon_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_salon_id := NULL;
  END;
  INSERT INTO users (id, email, role, full_name, salon_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'stylist'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    v_salon_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Riattiva il trigger su nuovi signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 3. Backfill: inserisci in public.users gli utenti auth esistenti che mancano
-- Se hai già un salone, sostituisci 'ID_DEL_TUO_SALONE' con l'id corretto,
-- altrimenti lascia NULL e assocerai dopo.
INSERT INTO public.users (id, email, role, full_name, salon_id)
SELECT
  au.id,
  au.email,
  COALESCE((au.raw_user_meta_data->>'role')::user_role, 'owner'),
  COALESCE(au.raw_user_meta_data->>'full_name', au.email),
  (SELECT id FROM public.salons LIMIT 1)  -- prende il primo salone esistente, o NULL
FROM auth.users au
WHERE au.id NOT IN (SELECT id FROM public.users);

-- 4. Verifica finale
SELECT id, email, role, full_name, salon_id FROM public.users;
