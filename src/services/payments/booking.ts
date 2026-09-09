import type { CreateCheckoutInput } from './service';

// Dati minimi di una prenotazione da creare a pagamento avvenuto.
export interface BookingPayload {
  salon_id: string;
  service_id: string;
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
  service: { price_cents: number; duration_minutes: number; name?: string };
  providerName: 'stripe' | 'nexi';
  successUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}): CreateCheckoutInput {
  const { booking, service, providerName, successUrl, cancelUrl, notifyUrl } = args;
  const start = new Date(booking.start_time);
  const end = new Date(start.getTime() + service.duration_minutes * 60_000);

  return {
    salonId: booking.salon_id,
    amountCents: service.price_cents,
    providerName,
    successUrl,
    cancelUrl,
    notifyUrl,
    productName: service.name,
    rowMetadata: {
      booking,
      slot: {
        stylist_id: booking.stylist_id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      },
    },
  };
}
