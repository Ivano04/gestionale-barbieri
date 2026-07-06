import { getAvailableSlots } from '@/services/booking-engine';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const service_id = searchParams.get('service_id');
  const stylist_id = searchParams.get('stylist_id');
  const date = searchParams.get('date');

  if (!salon_id || !service_id || !date) {
    return Response.json({ error: 'salon_id, service_id, date required' }, { status: 400 });
  }

  const slots = await getAvailableSlots({
    salon_id,
    service_id,
    stylist_id: stylist_id || undefined,
    date,
  });

  // Filter out past slots for today
  const now = new Date();
  const filtered = slots.filter(s => {
    const slotTime = new Date(`${date}T${s.time}:00`);
    return slotTime > now;
  });

  // Se non è stato specificato uno stylist, includi il carico per l'auto-assegnazione
  if (!stylist_id) {
    const supabase = createAdminClient();
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);
    const { data: counts } = await supabase
      .from('appointments')
      .select('stylist_id')
      .eq('salon_id', salon_id)
      .gte('start_time', dayStart.toISOString())
      .lte('start_time', dayEnd.toISOString())
      .neq('status', 'cancelled');

    // Conteggio appuntamenti per stylist
    const load: Record<string, number> = {};
    for (const a of (counts || [])) {
      if (a.stylist_id) load[a.stylist_id] = (load[a.stylist_id] || 0) + 1;
    }

    return Response.json({ slots: filtered, stylistLoad: load });
  }

  return Response.json(filtered);
}
