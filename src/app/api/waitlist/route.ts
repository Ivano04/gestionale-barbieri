import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { sendN8nEvent } from '@/lib/sync-webhook';

/** GET /api/waitlist — fetch active waitlist entries for a salon (dashboard) */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salonId = searchParams.get('salon_id');
  if (!salonId) return Response.json({ error: 'salon_id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('waitlist_entries')
    .select('*, service:services(*), stylist:users(id, full_name)')
    .eq('salon_id', salonId)
    .eq('status', 'waiting')
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true });

  return Response.json(data || []);
}

/** POST /api/waitlist — join waitlist (public booking widget) */
export async function POST(request: Request) {
  const body = await request.json();
  const supabase = createAdminClient();

  const { salon_id, service_id, stylist_id, preferred_date, preferred_time_start, preferred_time_end, first_name, last_name, phone, client_id } = body;

  if (!salon_id || !service_id || !preferred_date) {
    return Response.json({ error: 'salon_id, service_id, preferred_date required' }, { status: 400 });
  }

  // Resolve client if phone provided
  let resolvedClientId = client_id || null;
  if (!resolvedClientId && phone) {
    const { data: existing } = await supabase
      .from('clients').select('id')
      .eq('salon_id', salon_id).eq('phone', phone).limit(1);
    if (existing?.length) resolvedClientId = existing[0].id;
  }

  const { data: entry, error } = await supabase
    .from('waitlist_entries')
    .insert({
      salon_id,
      client_id: resolvedClientId,
      service_id,
      stylist_id: stylist_id || null,
      preferred_date,
      preferred_time_start: preferred_time_start || null,
      preferred_time_end: preferred_time_end || null,
      first_name: first_name || null,
      last_name: last_name || null,
      phone: phone || null,
      status: 'waiting',
    })
    .select('*, service:services(*)')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // If n8n is configured, it will handle SMS notification for waitlist join confirmation
  sendN8nEvent('waitlist.joined', {
    id: entry.id,
    salon_id,
    service_name: (entry as any).service?.name,
    client_name: first_name || 'Cliente',
    phone,
    preferred_date,
    preferred_time_start,
  });

  return Response.json(entry, { status: 201 });
}
