import { BOOKING_UUID, bookingServiceIds } from '@/lib/booking-services';
import type { BookingPayload } from './booking';
export function parseBookingRequest(raw: unknown, now = Date.now()): BookingPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Prenotazione incompleta');
  const b = raw as Record<string, unknown>;
  const ids = bookingServiceIds(b.service_ids, b.service_id);
  if (typeof b.salon_id !== 'string' || !BOOKING_UUID.test(b.salon_id) || typeof b.stylist_id !== 'string' || !BOOKING_UUID.test(b.stylist_id)) throw new Error('Salone o operatore non validi');
  if (typeof b.start_time !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(b.start_time)) throw new Error('Orario non valido');
  const start = new Date(b.start_time);
  if (!Number.isFinite(start.getTime()) || start.getTime() <= now || start.getTime() > now + 365*86400000 || start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) throw new Error('Orario non valido');
  if (!b.client || typeof b.client !== 'object') throw new Error('Dati cliente mancanti');
  const c = b.client as Record<string, unknown>;
  const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\x00-\x1f]/.test(value) ? value.trim() : null;
  const first = text(c.first_name, 80), last = text(c.last_name, 80), phone = text(c.phone, 30), email = text(c.email, 254);
  if (!first || !last || !phone || !/^\+?[\d ()-]{6,30}$/.test(phone) || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Controlla nome, cognome, telefono ed email');
  if (b.notes != null && (typeof b.notes !== 'string' || b.notes.length > 1000)) throw new Error('Le note devono contenere al massimo 1000 caratteri');
  // Explicit allowlist: a public request can never supply fiscal/timing snapshots or internal IDs.
  return { salon_id: b.salon_id.toLowerCase(), service_id: ids[0], service_ids: ids, stylist_id: b.stylist_id.toLowerCase(), start_time: start.toISOString(), source: 'widget',
    client: { first_name: first, last_name: last, phone, email }, notes: typeof b.notes === 'string' ? b.notes.trim() : '' };
}
