import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  if (!salon_id) return Response.json({ error: 'salon_id required' }, { status: 400 });

  const supabase = await createServerSupabase();
  let query = supabase.from('clients').select('*').eq('salon_id', salon_id).order('last_name');

  const search = searchParams.get('search');
  if (search) {
    query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from('clients')
    .insert(body)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...data } = body;
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const adminSupabase = createAdminClient();
  const { data: updated, error } = await adminSupabase
    .from('clients')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(updated);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if client has appointments
  const adminSupabase = createAdminClient();
  const { data: apps } = await adminSupabase
    .from('appointments')
    .select('id')
    .eq('client_id', id)
    .limit(1);

  if (apps?.length) {
    return Response.json(
      { error: 'Impossibile eliminare: il cliente ha appuntamenti associati' },
      { status: 409 }
    );
  }

  const { error } = await adminSupabase.from('clients').delete().eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ status: 'ok' });
}
