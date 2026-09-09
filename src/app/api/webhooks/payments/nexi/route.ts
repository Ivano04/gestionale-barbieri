import { createAdminClient } from '@/lib/supabase/admin';
import { createPaymentProvider, paymentConfigFromEnv } from '@/services/payments';
import { createSupabasePaymentsRepo } from '@/services/payments/repo';
import { applyWebhookEvent, confirmBookingFromPayment } from '@/services/payments/webhook';
import type { BookingPayload } from '@/services/payments/booking';

// POST /api/webhooks/payments/nexi
// Notifica server-to-server dell'esito da Nexi XPay (application/x-www-form-urlencoded).
// Verifica il MAC, aggiorna la riga payments, e a pagamento riuscito crea l'appuntamento.
// DEVE rispondere HTTP 200: finche' non riceve il 200, Nexi non considera conclusa la transazione.
export async function POST(request: Request) {
  const rawBody = await request.text();

  const config = paymentConfigFromEnv();
  let event;
  try {
    const provider = createPaymentProvider(config);
    event = provider.verifyWebhook(rawBody, '');
  } catch (err: any) {
    // MAC non valido o payload illeggibile: non tocchiamo il DB.
    return new Response(`Webhook rifiutato: ${err?.message || 'firma non valida'}`, { status: 400 });
  }

  try {
    const repo = createSupabasePaymentsRepo(createAdminClient());
    await applyWebhookEvent({ repo, event });

    // A pagamento riuscito, crea l'appuntamento riusando l'endpoint esistente
    // (mantiene i controlli conflitti e la sync verso Treatwell).
    const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    await confirmBookingFromPayment({
      repo,
      event,
      createAppointment: async (booking: BookingPayload) => {
        const res = await fetch(`${base}/api/appointments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.CRON_SECRET || '',
          },
          body: JSON.stringify(booking),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `creazione appuntamento fallita (${res.status})`);
        }
        const data = await res.json();
        return { id: data.id };
      },
    });
  } catch (err: any) {
    // Errore di persistenza/creazione: rispondiamo 500 cosi' Nexi puo' ritentare la notifica.
    return new Response(`Errore interno: ${err?.message || 'persistenza'}`, { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
