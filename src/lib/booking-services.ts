/** The same client duration is used by the widget, slots and checkout. */
export interface ServiceTiming {
  duration_minutes: number;
  duration_application?: number | null;
  duration_processing?: number | null;
  duration_finishing?: number | null;
}
export function clientServiceDuration(s: ServiceTiming): number {
  const phases = [s.duration_application, s.duration_processing, s.duration_finishing];
  const total = phases.reduce<number>((sum, n) => sum + (Number.isFinite(n) && (n ?? 0) > 0 ? n! : 0), 0);
  return total > 0 ? total : s.duration_minutes;
}
export const MAX_BOOKING_SERVICES = 10;
export const BOOKING_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function bookingServiceIds(value: unknown, fallback?: unknown): string[] {
  const ids = value === undefined ? [fallback] : value;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BOOKING_SERVICES ||
      ids.some(id => typeof id !== 'string' || !BOOKING_UUID.test(id))) throw new Error('Seleziona da 1 a 10 servizi validi');
  const normalized = ids.map(id => (id as string).toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error('Un servizio può essere selezionato una sola volta');
  if (fallback !== undefined && (typeof fallback !== 'string' || fallback.toLowerCase() !== normalized[0])) throw new Error('Selezione servizi incoerente');
  return normalized;
}
export interface BookedService {
  service_id: string;
  name: string;
  price_cents: number;
  duration_minutes: number;
  buffer_time_minutes: number;
}
export function snapshotServices(ids: string[], rows: (ServiceTiming & { id: string; name: string; price_cents: number; buffer_time_minutes?: number | null })[]): BookedService[] {
  const result = ids.map(id => {
    const row = rows.find(s => s.id === id);
    if (!row) throw new Error('Uno dei servizi selezionati non è più disponibile');
    const duration = clientServiceDuration(row), buffer = row.buffer_time_minutes ?? 0;
    if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 720 || !Number.isSafeInteger(buffer) || buffer < 0 || buffer > 120 ||
        !Number.isSafeInteger(row.price_cents) || row.price_cents <= 0 || row.price_cents > 1000000) throw new Error('Prezzo o durata del servizio non validi');
    return { service_id: id, name: row.name, price_cents: row.price_cents, duration_minutes: duration, buffer_time_minutes: buffer };
  });
  if (result.reduce((n,s) => n + s.duration_minutes + s.buffer_time_minutes, 0) > 720) throw new Error('La prenotazione supera la durata massima di una giornata');
  return result;
}
export function appointmentServiceName(a: { service?: { name?: string } | null; booked_services?: BookedService[] | null; added_services?: { name: string }[] | null }): string {
  return [a.booked_services?.[0]?.name ?? a.service?.name ?? 'Servizio', ...(a.added_services ?? []).map(s => s.name)].join(' + ');
}
