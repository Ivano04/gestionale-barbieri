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
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  // Use noon UTC to avoid timezone edge cases
  const today = dayNames[new Date(date + 'T12:00:00').getDay()];

  // Get salon hours for today
  const { data: salon } = await supabase.from('salons').select('working_hours, open_time, close_time').eq('id', salon_id).single();
  let wh = (salon?.working_hours || {}) as Record<string, any>;
  if (typeof wh === 'string') try { wh = JSON.parse(wh); } catch {}
  const salonDay = wh?.[today];
  if (Object.keys(wh).length > 0 && salonDay === null) return Response.json([]);
  const salonOpen = salonDay?.open || salon?.open_time || '09:00';
  const salonClose = salonDay?.close || salon?.close_time || '19:00';

  const { data: service } = await supabase.from('services').select('duration_minutes').eq('id', service_id).single();
  if (!service) return Response.json({ error: 'service not found' }, { status: 404 });
  const duration = service.duration_minutes;

  // Get stylists with their personal working hours
  let stylistQuery = supabase.from('users').select('id, full_name, working_hours').eq('salon_id', salon_id).eq('role', 'stylist');
  if (stylist_id) stylistQuery = stylistQuery.eq('id', stylist_id);
  const { data: stylists } = await stylistQuery;
  if (!stylists?.length) return Response.json([]);

  // Overall time range for queries (earliest open to latest close)
  const dayStart = new Date(`${date}T${salonOpen}:00+02:00`);
  const dayEnd = new Date(`${date}T${salonClose}:00+02:00`);

  const { data: appointments } = await supabase
    .from('appointments').select('stylist_id, start_time, end_time')
    .eq('salon_id', salon_id).gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString()).neq('status', 'cancelled');

  const { data: blocks } = await supabase
    .from('time_blocks').select('stylist_id, start_time, end_time')
    .eq('salon_id', salon_id).gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString());

  const occupied = [...(appointments || []), ...(blocks || [])];

  const slots: { time: string; stylist_id: string; stylist_name: string }[] = [];

  for (const stylist of stylists) {
    // Check stylist's personal working hours for today
    let swh = (stylist.working_hours || {}) as any;
    if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
    const stylistDay = swh?.[today];
    if (Object.keys(swh).length > 0 && stylistDay === null) continue;
    // Use stylist hours if set, otherwise fallback to salon hours
    const sOpen = stylistDay?.open || salonOpen;
    const sClose = stylistDay?.close || salonClose;
    const sStart = new Date(`${date}T${sOpen}:00+02:00`);
    const sEnd = new Date(`${date}T${sClose}:00+02:00`);

    let current = sStart;
    while (current < sEnd) {
      const slotEnd = addMinutes(current, duration);
      if (slotEnd > sEnd) break;
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

  return Response.json({ slots, debug: { salonOpen, salonClose, today, stylistCount: stylists.length } });
}
