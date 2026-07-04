/** Una fascia oraria (es. 09:00–13:00) */
export interface WorkingHoursShift {
  open: string;
  close: string;
}

/**
 * Rappresentazione di un giorno:
 * - null = giorno chiuso
 * - [] (array vuoto) = giorno chiuso
 * - [{ open, close }] = una fascia singola
 * - [{ open, close }, { open, close }] = due fasce (es. mattina + pomeriggio)
 */
export type WorkingHoursDay = WorkingHoursShift[] | null;

/** Mappa giorno → fasce */
export type WorkingHours = Record<string, WorkingHoursDay>;

/**
 * Normalizza un valore "day" al nuovo formato array.
 * Retrocompatibile con il vecchio formato { open, close }.
 *
 * @returns WorkingHoursShift[] | null
 */
export function normalizeShifts(day: unknown): WorkingHoursShift[] | null {
  if (day === null || day === undefined) return null;
  if (Array.isArray(day)) {
    const shifts = (day as WorkingHoursShift[]).filter(s => s && s.open && s.close);
    return shifts.length > 0 ? shifts : null;
  }
  if (typeof day === 'object') {
    const d = day as Record<string, unknown>;
    if (d.open && d.close) {
      return [{ open: String(d.open), close: String(d.close) }];
    }
  }
  return null;
}

/** True se il giorno ha almeno una fascia attiva */
export function dayHasShifts(day: WorkingHoursDay): boolean {
  const shifts = normalizeShifts(day);
  return shifts !== null && shifts.length > 0;
}

/**
 * Restituisce l'apertura più precoce e la chiusura più tardiva
 * tra tutte le fasce del giorno (per calcolare i bounds della timeline).
 */
export function shiftBounds(shifts: WorkingHoursShift[]): { open: string; close: string } {
  if (!shifts.length) return { open: '09:00', close: '19:00' };
  let earliest = shifts[0].open;
  let latest = shifts[0].close;
  for (const s of shifts) {
    if (s.open < earliest) earliest = s.open;
    if (s.close > latest) latest = s.close;
  }
  return { open: earliest, close: latest };
}

/** Data una data e un'ora "HH:MM", restituisce un oggetto Date */
export function timeToDate(isoDate: string, time: string, tzOffset: string): Date {
  return new Date(`${isoDate}T${time}:00${tzOffset}`);
}

/**
 * Data una fascia e una data, verifica se un appuntamento
 * (con inizio e durata) ci sta dentro la fascia.
 */
export function shiftFits(
  shift: WorkingHoursShift,
  date: string,
  slotTime: string,
  durationMinutes: number,
  tzOffset: string,
): boolean {
  const shiftStart = timeToDate(date, shift.open, tzOffset);
  const shiftEnd = timeToDate(date, shift.close, tzOffset);
  const slotStart = timeToDate(date, slotTime, tzOffset);
  const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);
  return slotStart >= shiftStart && slotEnd <= shiftEnd;
}
