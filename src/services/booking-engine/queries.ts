import { createAdminClient } from '@/lib/supabase/admin';
import type { ServiceOverride } from '@/lib/types';
import { normalizeShifts, type WorkingHoursShift } from '@/lib/working-hours';

export async function fetchSalonHours(salonId: string, dayName: string): Promise<WorkingHoursShift[] | null> {
  const supabase = createAdminClient();
  const { data: salon } = await supabase
    .from('salons')
    .select('working_hours, open_time, close_time')
    .eq('id', salonId)
    .single();

  let wh = (salon?.working_hours || {}) as Record<string, any>;
  if (typeof wh === 'string') try { wh = JSON.parse(wh); } catch {}

  const dayValue = wh?.[dayName];

  // Explicitly null in custom hours → closed
  if (Object.keys(wh).length > 0 && dayValue === null) return null;

  // Try new multi-shift format (or old single-shift auto-converted)
  const shifts = normalizeShifts(dayValue);
  if (shifts) return shifts;

  // No custom hours at all → use salon defaults as a single shift
  return [{
    open: salon?.open_time || '09:00',
    close: salon?.close_time || '19:00',
  }];
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

  if (serviceId) {
    // Get all stylists
    const { data: allStylists } = await supabase
      .from('users')
      .select('id, full_name, working_hours, is_active')
      .eq('salon_id', salonId)
      .eq('role', 'stylist');

    // Filter out inactive stylists
    const activeStylists = (allStylists || []).filter(s => s.is_active !== false);
    if (!activeStylists.length) return [];

    // Get stylists assigned to THIS service
    const { data: serviceAssignments } = await supabase
      .from('stylist_services')
      .select('stylist_id')
      .eq('service_id', serviceId);

    const assignedToService = new Set((serviceAssignments || []).map(a => a.stylist_id));

    // Get ALL stylists who have ANY assignment (these are in manual mode)
    const { data: allAssigned } = await supabase
      .from('stylist_services')
      .select('stylist_id');

    const hasAnyAssignment = new Set((allAssigned || []).map(a => a.stylist_id));

    if (hasAnyAssignment.size > 0) {
      // Filtering is active: eligible = assigned to this service OR in "all services" mode
      const eligible = activeStylists.filter(s =>
        assignedToService.has(s.id) || !hasAnyAssignment.has(s.id)
      );

      if (stylistId) return eligible.filter(s => s.id === stylistId);
      return eligible;
    }

    // No assignments at all — all stylists can do this service
    if (stylistId) return activeStylists.filter(s => s.id === stylistId);
    return activeStylists;
  }

  // No service filter — return all active stylists
  let query = supabase
    .from('users')
    .select('id, full_name, working_hours')
    .eq('salon_id', salonId)
    .eq('role', 'stylist')
    .eq('is_active', true);

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
