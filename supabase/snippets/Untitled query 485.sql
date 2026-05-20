-- 1. Creiamo un salone di prova obbligatorio
INSERT INTO public.salons (id, name, slug, address, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Il Mio Barbiere Locale', 'barbiere-locale', 'Via Roma 1', '012345678')
ON CONFLICT (id) DO NOTHING;

-- 2. Aggiorniamo l'utente che hai appena creato a mano per associarlo al salone e impostarlo come proprietario (owner)
UPDATE public.users 
SET salon_id = '11111111-1111-1111-1111-111111111111', role = 'owner', full_name = 'Gianluca Barbiere'
WHERE email = 'admin@barber.com';

-- 3. Se per qualche motivo la riga non esistesse ancora nella tabella pubblica, la inseriamo forzatamente usando l'ID corretto preso dall'autenticazione
INSERT INTO public.users (id, salon_id, email, role, full_name)
SELECT id, '11111111-1111-1111-1111-111111111111', email, 'owner', 'Gianluca Barbiere'
FROM auth.users 
WHERE email = 'admin@barber.com'
ON CONFLICT (id) DO NOTHING;