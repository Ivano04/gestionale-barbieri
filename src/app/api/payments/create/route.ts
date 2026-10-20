import { nexiNotifyUrl } from '@/services/payments/notify-url';
import { randomUUID } from 'node:crypto';
import { buildSalonReceipt, parseBasket } from '@/services/checkout/basket';
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPaymentProvider, paymentConfigFromEnv } from '@/services/payments';
import { createSupabasePaymentsRepo } from '@/services/payments/repo';
import { createPaymentCheckout } from '@/services/payments/service';
import { buildBookingCheckoutInput } from '@/services/payments/booking';
import { parseBookingRequest } from '@/services/payments/booking-request';
import { fetchBookingServices } from '@/services/booking-engine/catalog';
import { getAvailableSlots } from '@/services/booking-engine';
import { getRomeOffset } from '@/lib/date-utils';

export async function POST(request: NextRequest) {
  let body;
  let booking;
  try {
    body = await request.json();
    booking = parseBookingRequest(body?.booking);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Prenotazione incompleta' }, { status: 400 });
  }
  let services;
  try { services = await fetchBookingServices(booking.salon_id, booking.service_ids!); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Servizi non disponibili' }, { status: 400 }); }
  const amount = services.reduce((n,s) => n+s.price_cents, 0);
  const duration = services.reduce((n,s) => n+s.duration_minutes, 0);
  if ((body.expectedAmountCents !== undefined && body.expectedAmountCents !== amount) ||
      (body.expectedDurationMinutes !== undefined && body.expectedDurationMinutes !== duration)) {
    return Response.json({ error: 'Il listino è stato aggiornato. Ricarica la pagina e verifica servizi, durata e prezzo.' }, { status: 409 });
  }
  try {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(booking.start_time));
    const slots = await getAvailableSlots({ salon_id: booking.salon_id, service_id: booking.service_id, service_ids: booking.service_ids,
      stylist_id: booking.stylist_id, date, duration_minutes: duration+services.reduce((n,s) => n+s.buffer_time_minutes, 0) });
    if (!slots.some(s => new Date(`${date}T${s.time}:00${getRomeOffset(date)}`).toISOString() === booking.start_time)) {
      return Response.json({ error: 'L’orario non è più disponibile per tutti i servizi. Scegli un altro orario.', code: 'SLOT_UNAVAILABLE' }, { status: 409 });
    }
    const config = paymentConfigFromEnv();
    const base = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const input = buildBookingCheckoutInput({ booking, services, providerName: config.provider,
      successUrl: `${base}/pagamento/esito`, cancelUrl: `${base}/pagamento/esito`, notifyUrl: nexiNotifyUrl(base) });
    if (process.env.FISKALY_TEST_ENABLED === 'true') {
      if (config.provider !== 'nexi' || config.nexiEnv !== 'test' || process.env.FISKALY_ENV !== 'test') throw new Error('Fiscal integration requires Nexi and fiskaly TEST');
      input.rowMetadata = { ...input.rowMetadata, payment_environment: 'test',
        fiscal_receipt: buildSalonReceipt(parseBasket(services.map(s => ({ description: s.name, quantity: 1, unitPriceCents: s.price_cents, discountCents: 0 }))),
          'TEST-' + randomUUID().replaceAll('-', '').slice(0, 15).toUpperCase(), Number(process.env.FISKALY_TEST_VAT_PERCENT), 'card') };
    }
    const result = await createPaymentCheckout({ provider: createPaymentProvider(config), repo: createSupabasePaymentsRepo(createAdminClient()), input });
    return Response.json(result);
  } catch (e) {
    // The database checks holds under a salon lock as well: concurrent checkouts cannot both reserve the same time.
    if ((e as { code?: string })?.code === '23P01' || (e instanceof Error && e.message.includes('Slot no longer available'))) {
      return Response.json({ error: 'L’orario è appena stato occupato. Scegli un altro orario.', code: 'SLOT_UNAVAILABLE' }, { status: 409 });
    }
    console.error('[booking] checkout unavailable', (e as { code?: string })?.code ?? 'CHECKOUT_ERROR');
    return Response.json({ error: 'Impossibile avviare il pagamento. Riprova tra poco.' }, { status: 503 });
  }
}
