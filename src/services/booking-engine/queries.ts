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

/** Client-visible duration (excludes buffer, may include per-stylist override) */
export async function fetchServiceDuration(serviceId: string) {
  const supabase = createAdminClient();
  const { data: service } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .single();
  return service?.duration_minutes || null;
}

/** Fetch stylist-specific overrides for a service */
export async function fetchServiceOverride(
  serviceId: string,
  stylistId: string,
): Promise<Pick<ServiceOverride, 'buffer_time_minutes'> & { duration_minutes?: number } | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('service_overrides')
    .select('buffer_time_minutes')
    .eq('service_id', serviceId)
    .eq('stylist_id', stylistId)
    .maybeSingle();
  return data;
}

export async function fetchStylists(salonId: string, stylistId?: string, serviceId?: string) {
  const supabase = createAdminClient();

  // If a service is specified, check which stylists are explicitly assigned to it
  if (serviceId) {
    const { data: assignments } = await supabase
      .from('stylist_services')
      .select('stylist_id');

    // If any stylist has explicit assignments, filter by those
    if (assignments && assignments.length > 0) {
      // Get the service-specific assignments
      const { data: serviceAssignments } = await supabase
        .from('stylist_services')
        .select('stylist_id')
        .eq('service_id', serviceId);

      const eligibleIds = serviceAssignments?.map(a => a.stylist_id) || [];

      // If no stylist is assigned to this specific service, return empty
      if (eligibleIds.length === 0) return [];

      let query = supabase
        .from('users')
        .select('id, full_name, working_hours')
        .eq('salon_id', salonId)
        .eq('role', 'stylist')
        .in('id', eligibleIds);

      if (stylistId) query = query.eq('id', stylistId);
      const { data: stylists } = await query;
      return stylists || [];
    }
  }

  // Default: no filtering — all stylists can do all services
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
  dayEnd: Date,
) {
  const supabase = createAdminClient();
  // Use overlap queries: fetch any block/appointment that overlaps the day,
  // not just those starting within the day. A block from 23:00 yesterday to
  // 02:00 today must still block today's 01:00 slot.
  const [appsRes, blocksRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('stylist_id, start_time, end_time, buffer_end_time')
      .eq('salon_id', salonId)
      .lt('start_time', dayEnd.toISOString())
      .gt('end_time', dayStart.toISOString())
      .neq('status', 'cancelled'),
    supabase
      .from('time_blocks')
      .select('stylist_id, start_time, end_time')
      .eq('salon_id', salonId)
      .lt('start_time', dayEnd.toISOString())
      .gt('end_time', dayStart.toISOString()),
  ]);

  const mapBlock = (b: any) => ({
    stylist_id: b.stylist_id ?? null,
    start_time: new Date(b.start_time),
    end_time: b.buffer_end_time ? new Date(b.buffer_end_time) : new Date(b.end_time),
  });

  return [
    ...(appsRes.data || []).map(mapBlock),
    ...(blocksRes.data || []).map((b: any) => ({
      stylist_id: b.stylist_id ?? null,
      start_time: new Date(b.start_time),
      end_time: new Date(b.end_time),
    })),
  ];
}
