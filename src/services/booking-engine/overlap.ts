import { addMinutes } from 'date-fns';
import { computePhaseBreakdown, computePhaseRanges, isStylistBusy } from './phase-calculator';
import type { Service, ConflictResult } from '@/lib/types';

export interface OccupiedBlock {
  stylist_id: string | null;
  start_time: Date;
  end_time: Date;
  /** If this block has phase info (for soft-conflict detection) */
  service?: Pick<Service, 'duration_minutes' | 'duration_application' | 'duration_processing' | 'duration_finishing' | 'buffer_time_minutes'> | null;
}

export interface Slot {
  time: string;
  stylist_id: string;
  stylist_name: string;
}

export function isOverlap(a: Date, aEnd: Date, b: Date, bEnd: Date): boolean {
  return a < bEnd && aEnd > b;
}

/**
 * Checks if a proposed slot is free for the given stylist.
 * Returns a ConflictResult with severity:
 * - 'none': completely free
 * - 'soft': overlaps with another appointment's processing phase (stylist still available)
 * - 'hard': overlaps with an active phase (application/finishing/buffer) — stylist truly busy
 */
export function checkSlotConflict(
  stylistId: string,
  slotStart: Date,
  slotEnd: Date,
  occupied: OccupiedBlock[],
): ConflictResult {
  for (const o of occupied) {
    if (o.stylist_id !== stylistId) continue;
    if (!isOverlap(slotStart, slotEnd, o.start_time, o.end_time)) continue;

    // If the occupied block has phase info, check which phase overlaps
    if (o.service) {
      const phases = computePhaseBreakdown(o.service);
      const startMin = o.start_time.getHours() * 60 + o.start_time.getMinutes();
      const ranges = computePhaseRanges(startMin, phases);

      const slotStartMin = slotStart.getHours() * 60 + slotStart.getMinutes();
      const slotEndMin = slotEnd.getHours() * 60 + slotEnd.getMinutes();

      // Check if the overlap touches only the processing phase
      const overlapsApplication =
        slotStartMin < ranges.application.end && slotEndMin > ranges.application.start;
      const overlapsFinishing =
        slotStartMin < ranges.finishing.end && slotEndMin > ranges.finishing.start;
      const overlapsBuffer =
        ranges.buffer.start < ranges.buffer.end &&
        slotStartMin < ranges.buffer.end && slotEndMin > ranges.buffer.start;
      const overlapsProcessing =
        ranges.processing.start < ranges.processing.end &&
        slotStartMin < ranges.processing.end && slotEndMin > ranges.processing.start;

      if (overlapsApplication || overlapsFinishing || overlapsBuffer) {
        return {
          severity: 'hard',
          overlapPhase: overlapsApplication ? 'application' : overlapsFinishing ? 'finishing' : 'buffer',
        };
      }
      if (overlapsProcessing) {
        return {
          severity: 'soft',
          overlapPhase: 'processing',
        };
      }
    } else {
      // Legacy block (time_block or appointment without phase info) — hard conflict
      return { severity: 'hard' };
    }
  }

  return { severity: 'none' };
}

/**
 * Simple free-slot check for a stylist — hard conflicts only.
 * Used by the public booking engine to determine if a slot is bookable.
 */
export function isSlotFree(
  stylistId: string,
  slotStart: Date,
  slotEnd: Date,
  occupied: OccupiedBlock[],
): boolean {
  const result = checkSlotConflict(stylistId, slotStart, slotEnd, occupied);
  return result.severity !== 'hard';
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
