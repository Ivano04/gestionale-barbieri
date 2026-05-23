import {
  fetchSalonHours,
  fetchServiceWithPhases,
  fetchServiceOverride,
  fetchStylists,
  fetchOccupiedSlots,
} from './queries';
import { computePhaseBreakdown } from './phase-calculator';
import { generateSlots, type Slot, type OccupiedBlock } from './overlap';
import { getRomeOffset } from '@/lib/date-utils';

export interface GetAvailableSlotsParams {
  salon_id: string;
  service_id: string;
  stylist_id?: string;
  date: string;
}

export async function getAvailableSlots(params: GetAvailableSlotsParams): Promise<Slot[]> {
  const { salon_id, service_id, stylist_id, date } = params;
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = dayNames[new Date(date + 'T12:00:00').getDay()];
  const tzOffset = getRomeOffset(date);

  const hours = await fetchSalonHours(salon_id, today);
  if (!hours) return [];

  const service = await fetchServiceWithPhases(service_id);
  if (!service) return [];

  // Client-visible duration (excludes buffer)
  const clientDuration = (service.duration_application != null || service.duration_processing != null || service.duration_finishing != null)
    ? (service.duration_application ?? 0) + (service.duration_processing ?? 0) + (service.duration_finishing ?? 0)
    : service.duration_minutes;

  const stylists = await fetchStylists(salon_id, stylist_id);
  if (!stylists.length) return [];

  const dayStart = new Date(`${date}T${hours.open}:00${tzOffset}`);
  const dayEnd = new Date(`${date}T${hours.close}:00${tzOffset}`);

  const occupied = await fetchOccupiedSlots(salon_id, dayStart, dayEnd);

  const allSlots: Slot[] = [];

  for (const stylist of stylists) {
    let swh = (stylist.working_hours || {}) as any;
    if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
    const stylistDay = swh?.[today];
    if (Object.keys(swh).length > 0 && stylistDay === null) continue;

    const sOpen = stylistDay?.open || hours.open;
    const sClose = stylistDay?.close || hours.close;
    const sStart = new Date(`${date}T${sOpen}:00${tzOffset}`);
    const sEnd = new Date(`${date}T${sClose}:00${tzOffset}`);

    // Apply per-stylist duration overrides
    const override = stylist_id ? await fetchServiceOverride(service_id, stylist.id) : null;
    const phases = computePhaseBreakdown(service, override);
    // For slot generation, use client-visible duration; the engine already
    // handles phase decomposition for conflict detection via the occupied blocks
    const duration = phases.totalClientVisible;

    const slots = generateSlots({
      sStart, sEnd, duration, step: 30, occupied,
      stylistId: stylist.id, stylistName: stylist.full_name,
    });
    allSlots.push(...slots);
  }

  return allSlots;
}

export { checkSlotConflict, isSlotFree, generateSlots, type Slot, type OccupiedBlock } from './overlap';
export { computePhaseBreakdown, computePhaseRanges, isStylistBusy } from './phase-calculator';
export { findSwapCandidates } from './smart-swap';
