import { nexiNotifyUrl } from '@/services/payments/notify-url';
import { randomUUID } from 'node:crypto';
import { buildTestReceipt } from '@/services/fiscal/receipt-builder';
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPaymentProvider, paymentConfigFromEnv } from '@/services/payments';
import { createSupabasePaymentsRepo } from '@/services/payments/repo';
import { createPaymentCheckout } from '@/services/payments/service';
import { buildBookingCheckoutInput, type BookingPayload } from '@/services/payments/booking';

// POST /api/payments/create
// Avvia il pagamento di una prenotazione. NON crea ancora l'appuntamento:
// registra una riga payments (pending) che porta con se' la prenotazione (metadata)
// e funge da BLOCCO SLOT temporaneo. L'appuntamento nasce solo a pagamento riuscito
// (vedi webhook). L'importo e' preso dal prezzo del servizio nel DB, non dal client.
export async function POST(request: NextRequest) {
  let body: { booking?: BookingPayload } | null;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body JSON non valido' }, { status: 400 });
  }

  const booking: BookingPayload | undefined = body?.booking;
  if (!booking?.salon_id || !booking?.service_id || !booking?.stylist_id || !booking?.start_time || !booking?.client) {
    return Response.json({ error: 'Prenotazione incompleta' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Prezzo e durata dal DB (fonte di verita', non ci si fida del client)
  const { data: service, error: svcErr } = await admin
    .from('services')
    .select('price_cents, duration_minutes, name')
    .eq('id', booking.service_id)
    .eq('salon_id', booking.salon_id)
    .single();
  if (svcErr || !service) {
    return Response.json({ error: 'Servizio non trovato' }, { status: 404 });
  }
  if (!service.price_cents || service.price_cents <= 0) {
    return Response.json({ error: 'Il servizio non ha un prezzo valido per il pagamento online' }, { status: 400 });
  }

  const config = paymentConfigFromEnv();
  const base = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

  try {
    const provider = createPaymentProvider(config);
    const repo = createSupabasePaymentsRepo(admin);

    const input = buildBookingCheckoutInput({
      booking,
      service,
      providerName: config.provider,
      successUrl: `${base}/pagamento/esito`,
      cancelUrl: `${base}/pagamento/esito`,
      notifyUrl: nexiNotifyUrl(base),
    });

    if (process.env.FISKALY_TEST_ENABLED === 'true') {
      if (config.provider !== 'nexi' || config.nexiEnv !== 'test' || process.env.FISKALY_ENV !== 'test') {
        throw new Error('Fiscal integration requires Nexi and fiskaly TEST');
      }
      input.rowMetadata = { ...input.rowMetadata, payment_environment: 'test',
        fiscal_receipt: buildTestReceipt(service.price_cents, service.name,
          'TEST-' + randomUUID().replaceAll('-', '').slice(0, 15).toUpperCase(), Number(process.env.FISKALY_TEST_VAT_PERCENT)) };
    }
    const result = await createPaymentCheckout({ provider, repo, input });
    return Response.json(result);
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Errore creazione pagamento' }, { status: 500 });
  }
}
