import { createServerSupabase } from '@/lib/supabase/server';
import { sendN8nEvent } from '@/lib/sync-webhook';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  if (!salon_id) return Response.json({ error: 'salon_id required' }, { status: 400 });

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('time_blocks')
    .select('*')
    .eq('salon_id', salon_id)
    .gte('end_time', new Date().toISOString())
    .order('start_time');

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data || []);
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  // Check for conflicting appointments
  const conflictQuery = supabase
    .from('appointments')
    .select('id')
    .eq('salon_id', body.salon_id)
    .lt('start_time', body.end_time)
    .gt('end_time', body.start_time)
    .neq('status', 'cancelled');

  if (body.stylist_id) {
    conflictQuery.eq('stylist_id', body.stylist_id);
  }

  const { data: conflicts } = await conflictQuery.limit(1);
  if (conflicts?.length) {
    return Response.json(
      { error: 'Esistono appuntamenti in questa fascia oraria' },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from('time_blocks')
    .insert(body)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Fire-and-forget n8n webhook
  sendN8nEvent('time_block.created', {
    id: data.id,
    salon_id: data.salon_id,
    stylist_id: data.stylist_id,
    start_time: data.start_time,
    end_time: data.end_time,
    reason: data.reason,
  });

  return Response.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const supabase = await createServerSupabase();

  // Auth check
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { error } = await supabase.from('time_blocks').delete().eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ status: 'ok' });
}
