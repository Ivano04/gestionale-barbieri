import { addMinutes } from 'date-fns';

export interface OccupiedBlock {
  stylist_id: string | null;
  start_time: Date;
  end_time: Date;
  /** Periodi in cui lo stylist è occupato (applicazione + finitura).
   *  Se assente, tutto il blocco è considerato occupato (retrocompatibile). */
  busyPeriods?: { start: Date; end: Date }[];
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
 * Verifica se uno slot è libero, tenendo conto delle fasi di posa.
 * Durante la fase di processing lo stylist è libero per altri clienti.
 */
export function isSlotFree(
  stylistId: string,
  slotStart: Date,
  slotEnd: Date,
  occupied: OccupiedBlock[],
): boolean {
  return !occupied.some(o => {
    if (o.stylist_id && o.stylist_id !== stylistId) return false;
    // Se ci sono busyPeriods, controlla solo quelli (processing time è libero)
    if (o.busyPeriods?.length) {
      return o.busyPeriods.some(bp => isOverlap(slotStart, slotEnd, bp.start, bp.end));
    }
    // Altrimenti tutto il blocco è occupato (retrocompatibile)
    return isOverlap(slotStart, slotEnd, o.start_time, o.end_time);
  });
}

/**
 * Calcola i periodi di occupazione reale di un appuntamento con fasi.
 * - Applicazione: BUSY
 * - Processing (posa): FREE
 * - Finitura: BUSY
 * Se non ci sono fasi, tutto il periodo è BUSY.
 */
export function computeBusyPeriods(
  startTime: Date,
  endTime: Date,
  durationApp: number | null,
  durationProc: number | null,
  durationFin: number | null,
): { start: Date; end: Date }[] {
  const hasPhases = (durationApp ?? 0) > 0 || (durationProc ?? 0) > 0 || (durationFin ?? 0) > 0;
  if (!hasPhases) {
    // Nessuna fase: tutto il blocco è busy
    return [{ start: startTime, end: endTime }];
  }

  const busy: { start: Date; end: Date }[] = [];
  let cursor = startTime;

  // Applicazione
  if (durationApp && durationApp > 0) {
    const appEnd = addMinutes(cursor, durationApp);
    busy.push({ start: cursor, end: appEnd });
    cursor = appEnd;
  }

  // Processing (posa) — il cursore avanza ma NON viene aggiunto a busy
  if (durationProc && durationProc > 0) {
    cursor = addMinutes(cursor, durationProc);
  }

  // Finitura
  if (durationFin && durationFin > 0) {
    const finEnd = addMinutes(cursor, durationFin);
    busy.push({ start: cursor, end: finEnd });
  }

  // Se non ci sono periodi busy (caso edge), tutto il blocco è busy
  return busy.length > 0 ? busy : [{ start: startTime, end: endTime }];
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
