import { createAdminClient } from '@/lib/supabase/admin';

/** DELETE /api/waitlist/[id] — cancel a waitlist entry */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('waitlist_entries')
    .update({ status: 'cancelled' })
    .eq('id', id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ status: 'ok' });
}
