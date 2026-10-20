import { bookingServiceIds, snapshotServices } from '@/lib/booking-services';
import type { BookedService } from '@/lib/booking-services';
/** Only call with payment metadata read with server credentials, never the posted booking. */
export function paidBookingServices(metadata: Record<string, unknown>, amount: number): BookedService[] {
  if (metadata.booking_version !== 2) return [];
  const b = metadata.booking as { service_ids?: unknown; service_id?: unknown; start_time?: string; stylist_id?: string };
  const ids = bookingServiceIds(b?.service_ids, b?.service_id);
  if (!Array.isArray(metadata.booked_services)) throw new Error('Missing paid services');
  const saved = metadata.booked_services as BookedService[];
  const verified = snapshotServices(ids, saved.map(s => ({ ...s, id: s.service_id })));
  const slot = metadata.slot as { start_time?: string; end_time?: string; stylist_id?: string };
  const duration = verified.reduce((n,s) => n+s.duration_minutes+s.buffer_time_minutes, 0);
  if (saved.length !== ids.length || verified.reduce((n,s) => n+s.price_cents, 0) !== amount || slot?.stylist_id !== b.stylist_id ||
      slot?.start_time !== b.start_time || new Date(slot?.end_time ?? '').getTime() !== new Date(b.start_time ?? '').getTime()+duration*60000) throw new Error('Paid booking snapshot mismatch');
  return verified;
}
