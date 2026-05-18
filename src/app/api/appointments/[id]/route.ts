import { createServerSupabase } from '@/lib/supabase/server';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const body = await request.json();

  // Cleanup: convert empty strings to null
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    clean[k] = v === '' ? null : v;
  }

  const { data, error } = await supabase
    .from('appointments').update(clean).eq('id', id).select('*, client:clients(*), stylist:users(*), service:services(*)').single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ status: 'ok' });
}
