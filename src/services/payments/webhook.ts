import type { PaymentsRepo } from './service';
import type { BookingPayload } from './booking';
import type { WebhookEvent } from './types';

// Applica al DB l'effetto di un evento di pagamento gia' verificato.
// Trova la riga tramite il riferimento del provider e ne aggiorna lo stato.
// Gli eventi ancora "pending" non producono scritture.
export async function applyWebhookEvent(args: {
  repo: PaymentsRepo;
  event: WebhookEvent;
}): Promise<void> {
  const { repo, event } = args;

  if (event.status === 'pending') return;

  await repo.updateByProviderRef(event.providerRef, { status: event.status });
}

// A pagamento riuscito, crea l'appuntamento dalla prenotazione salvata in metadata
// e lo collega al pagamento. Idempotente: se l'appuntamento esiste gia' non fa nulla
// (Nexi puo' inviare piu' notifiche per lo stesso ordine).
export async function confirmBookingFromPayment(args: {
  repo: PaymentsRepo;
  event: WebhookEvent;
  createAppointment: (booking: BookingPayload) => Promise<{ id: string }>;
}): Promise<void> {
  const { repo, event, createAppointment } = args;

  if (event.status !== 'succeeded') return;

  const payment = await repo.getByProviderRef(event.providerRef);
  if (!payment) return;
  if (payment.appointment_id) return; // gia' confermato

  const booking = (payment.metadata as any)?.booking as BookingPayload | undefined;
  if (!booking) return;

  const appt = await createAppointment(booking);
  await repo.updateByProviderRef(event.providerRef, { appointment_id: appt.id });
}
