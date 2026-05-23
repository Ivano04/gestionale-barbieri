import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createServerSupabase();

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });
  }

  // Get user's profile (role + salon_id)
  const { data: profile } = await supabase
    .from('users')
    .select('role, salon_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['owner', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
  }

  const { full_name, email, password } = await request.json();

  if (!full_name || !email || !password) {
    return NextResponse.json({ error: 'Nome, email e password obbligatori' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // Create user in Supabase Auth
  const { data, error } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name,
      salon_id: profile.salon_id,
      role: 'stylist',
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const userId = data.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Errore creazione utente' }, { status: 500 });
  }

  // Ensure public.users row (in case the trigger didn't fire)
  const { error: upsertError } = await adminSupabase
    .from('users')
    .upsert({
      id: userId,
      salon_id: profile.salon_id,
      email,
      role: 'stylist',
      full_name,
    }, { onConflict: 'id' });

  if (upsertError) {
    // Clean up the auth user if profile creation fails
    await adminSupabase.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ id: userId, email, full_name }, { status: 201 });
}
