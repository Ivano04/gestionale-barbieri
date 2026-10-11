import { createServerSupabase } from '@/lib/supabase/server';
export async function fiscalStaffAccess() {
  const db = await createServerSupabase();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return { response: Response.json({ error: 'Non autenticato' }, { status: 401 }) };
  const { data: profile, error: profileError } = await db.from('users').select('salon_id').eq('id', user.id).single();
  if (profileError || !profile?.salon_id) return { response: Response.json({ error: 'Non autorizzato' }, { status: 403 }) };
  return { db, salonId: profile.salon_id as string };
}
