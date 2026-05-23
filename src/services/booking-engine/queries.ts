import { createAdminClient } from '@/lib/supabase/admin';
import type { ServiceOverride } from '@/lib/types';

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

export async function fetchServiceWithPhases(serviceId: string) {
  const supabase = createAdminClient();
  const { data: service } = await supabase
    .from('services')
    .select('duration_minutes, duration_application, duration_processing, duration_finishing, buffer_time_minutes')
    .eq('id', serviceId)
    .single();
  return service || null;
}

export async function fetchServiceDuration(serviceId: string) {
  const service = await fetchServiceWithPhases(serviceId);
  if (!service) return null;

  // Return totalClientVisible: if phases exist use them, else fallback to duration_minutes
  if (service.duration_application != null || service.duration_processing != null || service.duration_finishing != null) {
    return (service.duration_application ?? 0) + (service.duration_processing ?? 0) + (service.duration_finishing ?? 0);
  }
  return service.duration_minutes;
}

/** Client-visible duration (excludes buffer) */
export async function fetchClientDuration(serviceId: string) {
  const service = await fetchServiceWithPhases(serviceId);
  if (!service) return null;
  if (service.duration_application != null || service.duration_processing != null || service.duration_finishing != null) {
    return (service.duration_application ?? 0) + (service.duration_processing ?? 0) + (service.duration_finishing ?? 0);
  }
  return service.duration_minutes;
}

/** Fetch stylist-specific overrides for a service */
export async function fetchServiceOverride(
  serviceId: string,
  stylistId: string,
): Promise<Pick<ServiceOverride, 'duration_application' | 'duration_processing' | 'duration_finishing' | 'buffer_time_minutes'> | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('service_overrides')
    .select('duration_application, duration_processing, duration_finishing, buffer_time_minutes')
    .eq('service_id', serviceId)
    .eq('stylist_id', stylistId)
    .maybeSingle();
  return data;
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

/**
 * Fetch occupied slots for a day range.
 * Appointments now include phase info so the overlap engine can distinguish
 * active phases (hard conflict) from processing phases (soft conflict).
 */
export async function fetchOccupiedSlots(
  salonId: string,
  dayStart: Date,
  dayEnd: Date,
) {
  const supabase = createAdminClient();
  const [appsRes, blocksRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, stylist_id, start_time, end_time, buffer_end_time, service:services(duration_minutes, duration_application, duration_processing, duration_finishing, buffer_time_minutes)')
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
    // Use buffer_end_time if available for stylist blocking, else end_time
    end_time: b.buffer_end_time ? new Date(b.buffer_end_time) : new Date(b.end_time),
    service: b.service ?? null,
  });

  return [
    ...(appsRes.data || []).map(mapBlock),
    ...(blocksRes.data || []).map((b: any) => ({
      stylist_id: b.stylist_id ?? null,
      start_time: new Date(b.start_time),
      end_time: new Date(b.end_time),
      service: null, // time blocks have no phase info → always hard conflict
    })),
  ];
}
