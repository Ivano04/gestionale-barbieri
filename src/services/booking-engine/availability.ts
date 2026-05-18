import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes, format, parseISO } from 'date-fns';

interface SlotRequest {
  salon_id: string;
  service_id: string;
  stylist_id?: string;
  date: string;
}

interface Slot {
  time: string;
  stylist_id: string;
  stylist_name: string;
}

export async function getAvailableSlots(req: SlotRequest): Promise<Slot[]> {
  const supabase = createAdminClient();
  const { data: service } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', req.service_id)
    .single();
  if (!service) return [];
  const duration = service.duration_minutes;

  let stylistQuery = supabase
    .from('users')
    .select('id, full_name')
    .eq('salon_id', req.salon_id);
  if (req.stylist_id) stylistQuery = stylistQuery.eq('id', req.stylist_id);
  const { data: stylists } = await stylistQuery;
  if (!stylists?.length) return [];

  const dayStart = new Date(`${req.date}T08:00:00+02:00`);
  const dayEnd = new Date(`${req.date}T20:00:00+02:00`);

  const { data: appointments } = await supabase
    .from('appointments')
    .select('stylist_id, start_time, end_time')
    .eq('salon_id', req.salon_id)
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString())
    .neq('status', 'cancelled');

  const { data: blocks } = await supabase
    .from('time_blocks')
    .select('stylist_id, start_time, end_time')
    .eq('salon_id', req.salon_id)
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString());

  const occupied = [...(appointments || []), ...(blocks || [])];
  const slots: Slot[] = [];

  for (const stylist of stylists) {
    let current = dayStart;
    while (current < dayEnd) {
      const slotEnd = addMinutes(current, duration);
      if (slotEnd > dayEnd) break;
      const isFree = !occupied.some((o) => {
        if (o.stylist_id && o.stylist_id !== stylist.id) return false;
        const oStart = parseISO(o.start_time);
        const oEnd = parseISO(o.end_time);
        return current < oEnd && slotEnd > oStart;
      });
      if (isFree) {
        slots.push({
          time: format(current, 'HH:mm'),
          stylist_id: stylist.id,
          stylist_name: stylist.full_name,
        });
      }
      current = addMinutes(current, 30);
    }
  }
  return slots;
}
