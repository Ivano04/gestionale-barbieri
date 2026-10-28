import { appointmentOccupiedEnd } from '@/lib/appointment-time';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ServiceOverride } from '@/lib/types';
import { normalizeShifts, type WorkingHoursShift } from '@/lib/working-hours';
import { appointmentBusyPeriods } from './overlap';
import { clientServiceDuration } from '@/lib/booking-services';
import { activeHoldsToBlocks, HOLD_TTL_MS } from '@/services/payments/holds';

export async function fetchSalonHours(salonId: string, dayName: string): Promise<WorkingHoursShift[] | null> {
  const supabase = createAdminClient();
  const { data: salon, error } = await supabase
    .from('salons')
    .select('working_hours, open_time, close_time')
    .eq('id', salonId)
    .single();

  if (error) throw new Error('Impossibile leggere gli orari del salone');
  if (!salon) return null;
  let wh = (salon.working_hours || {}) as Record<string, any>;
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
    .select('duration_minutes,duration_application,duration_processing,duration_finishing')
    .eq('id', serviceId)
    .single();
  return service ? clientServiceDuration(service) : null;
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

export async function fetchStylists(salonId: string, stylistId?: string, serviceId?: string | string[]) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('users').select('id,full_name,working_hours,is_active')
    .eq('salon_id', salonId).eq('role', 'stylist').or('is_active.eq.true,is_active.is.null');
  if (error) throw new Error('Impossibile leggere gli operatori');
  const stylists = (data ?? []).filter(s => !stylistId || s.id === stylistId);
  if (!stylists.length || !serviceId) return stylists;
  const ids = Array.isArray(serviceId) ? serviceId : [serviceId];
  const { data: assignments, error: assignmentError } = await supabase.from('stylist_services')
    .select('stylist_id,service_id').in('stylist_id', stylists.map(s => s.id));
  if (assignmentError || (assignments?.length ?? 0) >= 1000) throw new Error('Impossibile verificare i servizi degli operatori');
  return stylists.filter(s => {
    const assigned = (assignments ?? []).filter(a => a.stylist_id === s.id);
    return !assigned.length || ids.every(id => assigned.some(a => a.service_id === id));
  });
}

export async function fetchOccupiedSlots(
  salonId: string,
  dayStart: Date,
  dayEnd: Date,
  excludeAppointmentId?: string,
) {
  const supabase = createAdminClient();
  // Use overlap queries: fetch any block/appointment that overlaps the day,
  // not just those starting within the day. A block from 23:00 yesterday to
  // 02:00 today must still block today's 01:00 slot.
  let appointmentsQuery = supabase.from('appointments').select('stylist_id, start_time, end_time, buffer_end_time, service_id, added_services, booked_services')
    .eq('salon_id', salonId).lt('start_time', dayEnd.toISOString()).or(`end_time.gt.${dayStart.toISOString()},buffer_end_time.gt.${dayStart.toISOString()}`).neq('status', 'cancelled');
  if (excludeAppointmentId) appointmentsQuery = appointmentsQuery.neq('id', excludeAppointmentId);
  const [appsRes, blocksRes] = await Promise.all([
    appointmentsQuery,
    supabase
      .from('time_blocks')
      .select('stylist_id, start_time, end_time')
      .eq('salon_id', salonId)
      .lt('start_time', dayEnd.toISOString())
      .gt('end_time', dayStart.toISOString()),
  ]);

  if (appsRes.error || blocksRes.error || (appsRes.data?.length ?? 0) >= 1000 || (blocksRes.data?.length ?? 0) >= 1000) throw new Error('Calendar availability unavailable');

  // Fetch service phases for appointments that have a service
  const serviceIds = [...new Set((appsRes.data || []).map((a: any) => a.service_id).filter(Boolean))];
  const { data: services } = serviceIds.length > 0
    ? await supabase.from('services').select('id, duration_application, duration_processing, duration_finishing').in('id', serviceIds as string[])
    : { data: [] };
  const serviceMap = new Map((services || []).map((s: any) => [s.id, s]));

  // A paid booking remains reserved while the payment webhook retries confirmation.
  const cutoff = new Date(Date.now() - HOLD_TTL_MS).toISOString();
  const { data: holds, error: holdsError } = await supabase.from('payments')
    .select('status,created_at,metadata,appointment_id').eq('salon_id', salonId)
    .or(`and(status.eq.pending,created_at.gte.${cutoff}),and(status.eq.succeeded,appointment_id.is.null)`);
  if (holdsError || (holds?.length ?? 0) >= 1000) throw new Error('Impossibile verificare le prenotazioni in pagamento');
  const holdBlocks = activeHoldsToBlocks(holds ?? [], new Date());

  const mapBlock = (b: any) => {
    const startTime = new Date(b.start_time);
    const endTime = appointmentOccupiedEnd(b);
    const svc = serviceMap.get(b.service_id);
    const busyPeriods = appointmentBusyPeriods(b, svc);
    return {
      stylist_id: b.stylist_id ?? null,
      start_time: startTime,
      end_time: endTime,
      busyPeriods,
    };
  };

  return [
    ...(appsRes.data || []).map(mapBlock),
    ...(blocksRes.data || []).map((b: any) => ({
      stylist_id: b.stylist_id ?? null,
      start_time: new Date(b.start_time),
      end_time: new Date(b.end_time),
    })),
    ...holdBlocks,
  ];
}
