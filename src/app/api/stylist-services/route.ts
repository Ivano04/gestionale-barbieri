import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** GET /api/stylist-services?salon_id=X&stylist_id=Y — stylist's services
 *  GET /api/stylist-services?salon_id=X&service_id=Y — service's stylists */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const stylist_id = searchParams.get('stylist_id');
  const service_id = searchParams.get('service_id');

  if (!salon_id) {
    return Response.json({ error: 'salon_id required' }, { status: 400 });
  }

  const supabase = await createServerSupabase();

  if (stylist_id) {
    const { data, error } = await supabase
      .from('stylist_services')
      .select('service_id')
      .eq('stylist_id', stylist_id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data.map((r: { service_id: string }) => r.service_id));
  }

  if (service_id) {
    const { data, error } = await supabase
      .from('stylist_services')
      .select('stylist_id')
      .eq('service_id', service_id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data.map((r: { stylist_id: string }) => r.stylist_id));
  }

  return Response.json({ error: 'stylist_id or service_id required' }, { status: 400 });
}

/** POST /api/stylist-services — replace all assignments for a stylist */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { stylist_id, service_ids } = body;
  if (!stylist_id || !Array.isArray(service_ids)) {
    return Response.json({ error: 'stylist_id and service_ids[] required' }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // Delete all existing assignments for this stylist
  await adminSupabase.from('stylist_services').delete().eq('stylist_id', stylist_id);

  // Insert new assignments (skip if empty array — means "all services")
  if (service_ids.length > 0) {
    const rows = service_ids.map((service_id: string) => ({ stylist_id, service_id }));
    const { error } = await adminSupabase.from('stylist_services').insert(rows);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ stylist_id, service_ids });
}
