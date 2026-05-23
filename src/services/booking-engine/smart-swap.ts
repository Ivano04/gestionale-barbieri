import { isSlotFree } from './overlap';
import type { OccupiedBlock } from './overlap';
import type { SwapSuggestion } from '@/lib/types';

export interface StylistInfo {
  id: string;
  full_name: string;
}

/**
 * Given a conflicting appointment and a list of all stylists, finds alternative
 * stylists that are free during the same time slot.
 *
 * Used after a drag/resize that causes a conflict — the UI can offer
 * to move the bumped appointment to another compatible stylist.
 */
export function findSwapCandidates(
  conflictingAppointment: { id: string; start_time: Date; end_time: Date; stylist_id?: string | null },
  allStylists: StylistInfo[],
  occupied: OccupiedBlock[],
): SwapSuggestion[] {
  const suggestions: SwapSuggestion[] = [];

  for (const stylist of allStylists) {
    // Don't suggest the same stylist
    if (stylist.id === conflictingAppointment.stylist_id) continue;

    // Check if this stylist is free during the conflicting appointment's time
    const free = isSlotFree(
      stylist.id,
      conflictingAppointment.start_time,
      conflictingAppointment.end_time,
      occupied,
    );

    if (free) {
      suggestions.push({
        appointmentId: conflictingAppointment.id,
        targetStylistId: stylist.id,
        targetStylistName: stylist.full_name,
        reason: `${stylist.full_name} è libero in questo slot`,
      });
    }
  }

  return suggestions;
}
