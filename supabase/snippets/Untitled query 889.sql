-- 1. Puliamo via i rimasugli dei tentativi precedenti in entrambe le tabelle
DELETE FROM public.users WHERE id = '22222222-2222-2222-2222-222222222222';
DELETE FROM auth.users WHERE id = '22222222-2222-2222-2222-222222222222';

-- 2. Assicuriamoci che il salone esista (se c'è già, non fa nulla)
INSERT INTO public.salons (id, name, slug, address, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Il Mio Barbiere Locale', 'barbiere-locale', 'Via Roma 1', '012345678')
ON CONFLICT (id) DO NOTHING;

-- 3. Inseriamo l'utente nel sistema di autenticazione privato (password: password123)
INSERT INTO auth.users (
  id, 
  email, 
  encrypted_password, 
  email_confirmed_at, 
  raw_app_meta_data, 
  raw_user_meta_data, 
  role,
  aud
)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'admin@barber.com',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Gianluca Barbiere"}',
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO NOTHING;

-- 4. Colleghiamo l'utente al salone con i massimi privilegi
INSERT INTO public.users (id, salon_id, email, role, full_name)
VALUES (
  '22222222-2222-2222-2222-222222222222', 
  '11111111-1111-1111-1111-111111111111', 
  'admin@barber.com', 
  'owner', 
  'Gianluca Barbiere'
)
ON CONFLICT (id) DO NOTHING;