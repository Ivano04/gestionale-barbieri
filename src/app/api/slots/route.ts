import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes, format, parseISO } from 'date-fns';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const service_id = searchParams.get('service_id');
  const stylist_id = searchParams.get('stylist_id');
  const date = searchParams.get('date');

  if (!salon_id || !service_id || !date) {
    return Response.json({ error: 'salon_id, service_id, date required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: service } = await supabase
    .from('services').select('duration_minutes').eq('id', service_id).single();
  if (!service) return Response.json({ error: 'service not found' }, { status: 404 });
  const duration = service.duration_minutes;

  let stylistQuery = supabase.from('users').select('id, full_name').eq('salon_id', salon_id).eq('role', 'stylist');
  if (stylist_id) stylistQuery = stylistQuery.eq('id', stylist_id);
  const { data: stylists } = await stylistQuery;
  if (!stylists?.length) return Response.json([]);

  const dayStart = new Date(`${date}T08:00:00+02:00`);
  const dayEnd = new Date(`${date}T20:00:00+02:00`);

  const { data: appointments } = await supabase
    .from('appointments')
    .select('stylist_id, start_time, end_time')
    .eq('salon_id', salon_id)
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString())
    .neq('status', 'cancelled');

  const { data: blocks } = await supabase
    .from('time_blocks')
    .select('stylist_id, start_time, end_time')
    .eq('salon_id', salon_id)
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString());

  const occupied = [...(appointments || []), ...(blocks || [])];

  const slots: { time: string; stylist_id: string; stylist_name: string }[] = [];
  for (const stylist of stylists) {
    let current = dayStart;
    while (current < dayEnd) {
      const slotEnd = addMinutes(current, duration);
      if (slotEnd > dayEnd) break;

      const isFree = !occupied.some(o => {
        if (o.stylist_id && o.stylist_id !== stylist.id) return false;
        const oStart = parseISO(o.start_time);
        const oEnd = parseISO(o.end_time);
        return current < oEnd && slotEnd > oStart;
      });

      if (isFree) {
        slots.push({ time: format(current, 'HH:mm'), stylist_id: stylist.id, stylist_name: stylist.full_name });
      }
      current = addMinutes(current, 30);
    }
  }

  return Response.json(slots);
}
