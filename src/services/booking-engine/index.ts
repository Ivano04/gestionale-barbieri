import { fetchBookingServices } from './catalog';
import {
  fetchSalonHours,
  fetchServiceDuration,
  fetchStylists,
  fetchOccupiedSlots,
} from './queries';
import { generateSlots, type Slot } from './overlap';
import { getRomeOffset } from '@/lib/date-utils';
import { normalizeShifts, type WorkingHoursShift, shiftBounds } from '@/lib/working-hours';

export interface GetAvailableSlotsParams {
  salon_id: string;
  service_id: string;
  service_ids?: string[];
  stylist_id?: string;
  date: string;
  exclude_appointment_id?: string;
  duration_minutes?: number;
}

export async function getAvailableSlots(params: GetAvailableSlotsParams): Promise<Slot[]> {
  const { salon_id, service_id, stylist_id, date } = params;
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = dayNames[new Date(date + 'T12:00:00').getDay()];
  const tzOffset = getRomeOffset(date);

  const hours = await fetchSalonHours(salon_id, today);
  if (!hours) return [];

  const selected = params.service_ids && !params.duration_minutes ? await fetchBookingServices(salon_id, params.service_ids) : null;
  const duration = params.duration_minutes ?? (selected ? selected.reduce((n,s) => n+s.duration_minutes+s.buffer_time_minutes, 0) : await fetchServiceDuration(service_id));
  if (!duration) return [];

  const stylists = await fetchStylists(salon_id, stylist_id, params.service_ids ?? service_id);
  if (!stylists.length) return [];

  const bounds = shiftBounds(hours);
  const dayStart = new Date(`${date}T${bounds.open}:00${tzOffset}`);
  const dayEnd = new Date(`${date}T${bounds.close}:00${tzOffset}`);

  const occupied = await fetchOccupiedSlots(salon_id, dayStart, dayEnd, params.exclude_appointment_id);

  const allSlots: Slot[] = [];

  for (const stylist of stylists) {
    // Parse stylist's custom working hours for today
    let swh = (stylist.working_hours || {}) as any;
    if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
    const stylistDay = swh?.[today];

    // Explicitly closed for this day
    if (Object.keys(swh).length > 0 && stylistDay === null) continue;

    // Normalize to multi-shift format; fallback to salon shifts
    let stylistShifts: WorkingHoursShift[] | null = normalizeShifts(stylistDay);
    if (!stylistShifts) stylistShifts = hours;
    if (!stylistShifts) continue;

    for (const own of stylistShifts) for (const salonShift of hours) {
      const shift = { open: own.open > salonShift.open ? own.open : salonShift.open, close: own.close < salonShift.close ? own.close : salonShift.close };
      if (shift.open >= shift.close) continue;
      const sStart = new Date(`${date}T${shift.open}:00${tzOffset}`);
      const sEnd = new Date(`${date}T${shift.close}:00${tzOffset}`);

      const slots = generateSlots({
        sStart, sEnd, duration, step: 15, occupied,
        stylistId: stylist.id, stylistName: stylist.full_name,
      });
      allSlots.push(...slots);
    }
  }

  return [...new Map(allSlots.map(s => [`${s.stylist_id}:${s.time}`, s])).values()];
}

export { isSlotFree, generateSlots, computeBusyPeriods, type Slot, type OccupiedBlock } from './overlap';
export { findSwapCandidates } from './smart-swap';
