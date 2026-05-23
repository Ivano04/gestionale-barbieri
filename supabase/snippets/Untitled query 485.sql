-- Crea il salone obbligatorio
INSERT INTO public.salons (id, name, slug, address, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Il Mio Barbiere Locale', 'barbiere-locale', 'Via Roma 1', '012345678')
ON CONFLICT (id) DO NOTHING;

-- Collega l'utente creato al salone come proprietario
INSERT INTO public.users (id, salon_id, email, role, full_name)
SELECT id, '11111111-1111-1111-1111-111111111111', email, 'owner', 'Gianluca Barbiere'
FROM auth.users 
WHERE email = 'admin@barber.com'
ON CONFLICT (id) DO NOTHING;