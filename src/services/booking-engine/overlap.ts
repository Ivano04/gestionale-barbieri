import { addMinutes } from 'date-fns';

export interface OccupiedBlock {
  stylist_id: string | null;
  start_time: Date;
  end_time: Date;
}

export function isOverlap(a: Date, aEnd: Date, b: Date, bEnd: Date): boolean {
  return a < bEnd && aEnd > b;
}

export function isSlotFree(
  stylistId: string,
  slotStart: Date,
  slotEnd: Date,
  occupied: OccupiedBlock[]
): boolean {
  return !occupied.some(o => {
    if (o.stylist_id && o.stylist_id !== stylistId) return false;
    return isOverlap(slotStart, slotEnd, o.start_time, o.end_time);
  });
}

export interface GenerateSlotsParams {
  sStart: Date;
  sEnd: Date;
  duration: number;
  step: number;
  occupied: OccupiedBlock[];
  stylistId: string;
  stylistName: string;
}

export interface Slot {
  time: string;
  stylist_id: string;
  stylist_name: string;
}

export function generateSlots(params: GenerateSlotsParams): Slot[] {
  const { sStart, sEnd, duration, step, occupied, stylistId, stylistName } = params;
  const slots: Slot[] = [];
  let current = sStart;
  while (current < sEnd) {
    const slotEnd = addMinutes(current, duration);
    if (slotEnd > sEnd) break;
    if (isSlotFree(stylistId, current, slotEnd, occupied)) {
      const time = current.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
      slots.push({ time, stylist_id: stylistId, stylist_name: stylistName });
    }
    current = addMinutes(current, step);
  }
  return slots;
}
