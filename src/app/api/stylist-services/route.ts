import { bookingServiceIds } from '@/lib/booking-services';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** GET /api/stylist-services?salon_id=X&stylist_id=Y — stylist's services
 *  GET /api/stylist-services?salon_id=X&service_id=Y — service's stylists
 *
 *  When filtering by service, includes stylists in "all services" mode
 *  (those with no stylist_services entries at all). */
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

  if (service_id || searchParams.has('service_ids')) {
    let serviceIds: string[];
    try { serviceIds = bookingServiceIds(searchParams.has('service_ids') ? searchParams.get('service_ids')!.split(',') : undefined, service_id ?? undefined); }
    catch { return Response.json({ error: 'Servizi non validi' }, { status: 400 }); }
    // Get active stylists (NULL is_active = active, for stylists created before migration)
    const { data: allStylists } = await supabase
      .from('users')
      .select('id')
      .eq('salon_id', salon_id)
      .eq('role', 'stylist')
      .or('is_active.eq.true,is_active.is.null');

    if (!allStylists?.length) return Response.json([]);

    // Stylists explicitly assigned to THIS service
    const { data: serviceAssignments } = await supabase
      .from('stylist_services')
      .select('stylist_id,service_id')
      .in('service_id', serviceIds);

    const assignedToAll = (stylistId: string) => serviceIds.every(id => serviceAssignments?.some(a => a.stylist_id === stylistId && a.service_id === id));

    // All stylists who have ANY assignment (determines if filtering is active)
    const { data: allAssigned } = await supabase
      .from('stylist_services')
      .select('stylist_id');

    const hasAnyAssignment = new Set((allAssigned || []).map((a: any) => a.stylist_id));

    if (hasAnyAssignment.size > 0) {
      // Filtering active: eligible = assigned to this service OR in "all services" mode
      const eligibleIds = allStylists
        .filter(s => assignedToAll(s.id) || !hasAnyAssignment.has(s.id))
        .map(s => s.id);
      return Response.json(eligibleIds);
    }

    // No assignments at all → all stylists can do this service
    return Response.json(allStylists.map(s => s.id));
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
