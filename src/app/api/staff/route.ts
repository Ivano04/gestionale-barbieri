import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export async function POST(request: Request) {
  const supabase = await createServerSupabase();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });
  }

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

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const result = await pool.query(
      `INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        $1,
        crypt($2, gen_salt('bf')),
        now(),
        jsonb_build_object('salon_id', $3::text, 'full_name', $4::text, 'role', 'stylist'),
        now(), now(),
        '', '', '', ''
      )
      RETURNING id`,
      [email, password, profile.salon_id, full_name]
    );

    return NextResponse.json(
      { id: result.rows[0].id, email, full_name },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Errore creazione operatore:', error);
    return NextResponse.json(
      { error: error.message || 'Errore creazione utente' },
      { status: 500 }
    );
  } finally {
    await pool.end();
  }
}
