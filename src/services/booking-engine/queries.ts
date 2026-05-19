import { createAdminClient } from '@/lib/supabase/admin';

export interface SlotRequest {
  salon_id: string;
  service_id: string;
  stylist_id?: string;
  date: string;
}

export async function fetchSalonHours(salonId: string, dayName: string) {
  const supabase = createAdminClient();
  const { data: salon } = await supabase
    .from('salons')
    .select('working_hours, open_time, close_time')
    .eq('id', salonId)
    .single();

  let wh = (salon?.working_hours || {}) as Record<string, any>;
  if (typeof wh === 'string') try { wh = JSON.parse(wh); } catch {}

  const salonDay = wh?.[dayName];
  if (Object.keys(wh).length > 0 && salonDay === null) return null;

  return {
    open: salonDay?.open || salon?.open_time || '09:00',
    close: salonDay?.close || salon?.close_time || '19:00',
  };
}

export async function fetchServiceDuration(serviceId: string) {
  const supabase = createAdminClient();
  const { data: service } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .single();
  return service?.duration_minutes || null;
}

export async function fetchStylists(salonId: string, stylistId?: string) {
  const supabase = createAdminClient();
  let query = supabase
    .from('users')
    .select('id, full_name, working_hours')
    .eq('salon_id', salonId)
    .eq('role', 'stylist');
  if (stylistId) query = query.eq('id', stylistId);
  const { data: stylists } = await query;
  return stylists || [];
}

export async function fetchOccupiedSlots(
  salonId: string,
  dayStart: Date,
  dayEnd: Date
) {
  const supabase = createAdminClient();
  const [appsRes, blocksRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('stylist_id, start_time, end_time')
      .eq('salon_id', salonId)
      .gte('start_time', dayStart.toISOString())
      .lte('start_time', dayEnd.toISOString())
      .neq('status', 'cancelled'),
    supabase
      .from('time_blocks')
      .select('stylist_id, start_time, end_time')
      .eq('salon_id', salonId)
      .gte('start_time', dayStart.toISOString())
      .lte('start_time', dayEnd.toISOString()),
  ]);

  const mapBlock = (b: any) => ({
    stylist_id: b.stylist_id ?? null,
    start_time: new Date(b.start_time),
    end_time: new Date(b.end_time),
  });

  return [
    ...(appsRes.data || []).map(mapBlock),
    ...(blocksRes.data || []).map(mapBlock),
  ];
}
