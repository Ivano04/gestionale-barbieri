import type { BookedService } from '@/lib/booking-services';
import type { CreateCheckoutInput } from './service';

// Dati minimi di una prenotazione da creare a pagamento avvenuto.
export interface BookingPayload {
  internal_payment_id?: string;
  salon_id: string;
  service_id: string;
  service_ids?: string[];
  stylist_id: string;
  start_time: string;
  source?: string;
  client: { first_name: string; last_name: string; phone: string; email?: string | null };
  notes?: string;
}

// Costruisce l'input del checkout a partire dalla prenotazione:
//  - l'importo viene dal prezzo del servizio (DB), MAI da valori inviati dal client
//  - salva la prenotazione completa in rowMetadata.booking (per crearla dopo il pagamento)
//  - salva slot (stylist + start + end) in rowMetadata.slot (per il blocco temporaneo)
export function buildBookingCheckoutInput(args: {
  booking: BookingPayload;
  service?: { price_cents: number; duration_minutes: number; name?: string };
  services?: BookedService[];
  providerName: 'stripe' | 'nexi';
  successUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}): CreateCheckoutInput {
  const { booking, service, providerName, successUrl, cancelUrl, notifyUrl } = args;
  const services = args.services;
  if (!services?.length && !service) throw new Error('Servizi mancanti');
  const duration = services ? services.reduce((n,s) => n+s.duration_minutes+s.buffer_time_minutes, 0) : service!.duration_minutes;
  const amount = services ? services.reduce((n,s) => n+s.price_cents, 0) : service!.price_cents;
  const start = new Date(booking.start_time);
  const end = new Date(start.getTime() + duration * 60_000);

  return {
    salonId: booking.salon_id,
    amountCents: amount,
    providerName,
    successUrl,
    cancelUrl,
    notifyUrl,
    productName: services ? services.map(s => s.name).join(" + ") : service!.name,
    rowMetadata: {
      booking,
      ...(services ? { booking_version: 2, booked_services: services } : {}),
      slot: {
        stylist_id: booking.stylist_id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      },
    },
  };
}
