import { appointmentOccupiedEnd } from '@/lib/appointment-time';
import { createServerSupabase } from '@/lib/supabase/server';
import { getAvailableSlots } from '@/services/booking-engine';
import { createAdminClient } from '@/lib/supabase/admin';
import { BOOKING_UUID, bookingServiceIds } from '@/lib/booking-services';
import { calendarRange } from '@/lib/calendar-range';
import { getRomeOffset } from '@/lib/date-utils';
import { validDate } from '@/services/rescheduling/logic';

export async function GET(request: Request) {
  const { searchParams: p } = new URL(request.url);
  const salon_id = p.get('salon_id'), stylist_id = p.get('stylist_id'), date = p.get('date');
  let ids: string[];
  try {
    ids = bookingServiceIds(p.has('service_ids') ? p.get('service_ids')!.split(',') : undefined, p.get('service_id') ?? undefined);
    if (!salon_id || !BOOKING_UUID.test(salon_id) || (stylist_id && !BOOKING_UUID.test(stylist_id)) || !date || !validDate(date)) throw new Error('Parametri non validi');
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Parametri non validi' }, { status: 400 }); }
  try {
    let duration: number | undefined;
    const appointmentId = p.get('appointment_id');
    if (appointmentId) {
      if (!BOOKING_UUID.test(appointmentId)) return Response.json({ error: 'Appuntamento non valido' }, { status: 400 });
      // The staff time picker must use the stored full duration. RLS prevents public/foreign access.
      const db = await createServerSupabase();
      const { data: a, error } = await db.from('appointments').select('service_id,added_services,start_time,end_time,buffer_end_time')
        .eq('id', appointmentId).eq('salon_id', salon_id).maybeSingle();
      if (error || !a) return Response.json({ error: 'Appuntamento non disponibile' }, { status: 404 });
      if (a.service_id === ids[0]) {
        ids = [...new Set<string>([ids[0], ...(a.added_services ?? []).map((s: { service_id: string }) => s.service_id)])];
        duration = (appointmentOccupiedEnd(a).getTime()-new Date(a.start_time).getTime())/60000;
      }
    }
    const slots = await getAvailableSlots({ salon_id, service_id: ids[0], service_ids: p.has('service_ids') || appointmentId ? ids : undefined, stylist_id: stylist_id || undefined, date, exclude_appointment_id: appointmentId ?? undefined, duration_minutes: duration });
    const filtered = slots.filter(s => new Date(`${date}T${s.time}:00${getRomeOffset(date)}`).getTime() > Date.now());
    if (stylist_id) return Response.json(filtered, { headers: { 'Cache-Control': 'no-store' } });
    const range = calendarRange(date, date);
    const { data: counts, error } = await createAdminClient().from('appointments').select('stylist_id').eq('salon_id', salon_id)
      .gte('start_time', range.start).lt('start_time', range.end).neq('status', 'cancelled');
    if (error) throw new Error('Availability unavailable');
    const load: Record<string, number> = {};
    for (const a of counts ?? []) if (a.stylist_id) load[a.stylist_id] = (load[a.stylist_id] ?? 0)+1;
    return Response.json({ slots: filtered, stylistLoad: load }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Impossibile caricare gli orari. Riprova tra poco.' }, { status: 503 }); }
}
