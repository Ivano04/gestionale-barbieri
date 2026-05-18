import { createServerSupabase } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  if (!salon_id) return Response.json({ error: 'salon_id required' }, { status: 400 });

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('time_blocks')
    .select('*')
    .eq('salon_id', salon_id)
    .order('start_time');

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const body = await request.json();
  const { data, error } = await supabase
    .from('time_blocks')
    .insert(body)
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('time_blocks').delete().eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ status: 'ok' });
}
