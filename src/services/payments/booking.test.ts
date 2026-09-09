import { describe, it, expect } from 'vitest';
import { buildBookingCheckoutInput } from './booking';

const booking = {
  salon_id: 'salon_1',
  service_id: 'svc_1',
  stylist_id: 'st_1',
  start_time: '2026-09-09T11:00:00.000Z',
  client: { first_name: 'Mario', last_name: 'Rossi', phone: '+39333', email: 'm@r.it' },
  notes: 'niente',
};

const urls = {
  successUrl: 'https://app/ok',
  cancelUrl: 'https://app/ko',
  notifyUrl: 'https://app/notify',
};

describe('buildBookingCheckoutInput', () => {
  it('prende l\'importo dal prezzo del servizio (DB), ignorando input del client', () => {
    const input = buildBookingCheckoutInput({
      booking, service: { price_cents: 3000, duration_minutes: 30 }, providerName: 'nexi', ...urls,
    });
    expect(input.amountCents).toBe(3000);
    expect(input.salonId).toBe('salon_1');
    expect(input.providerName).toBe('nexi');
  });

  it('calcola end_time dello slot come start + durata servizio', () => {
    const input = buildBookingCheckoutInput({
      booking, service: { price_cents: 3000, duration_minutes: 45 }, providerName: 'nexi', ...urls,
    });
    const slot = (input.rowMetadata as any).slot;
    expect(slot.stylist_id).toBe('st_1');
    expect(slot.start_time).toBe('2026-09-09T11:00:00.000Z');
    expect(slot.end_time).toBe('2026-09-09T11:45:00.000Z');
  });

  it('conserva la prenotazione completa nei metadata per crearla dopo il pagamento', () => {
    const input = buildBookingCheckoutInput({
      booking, service: { price_cents: 3000, duration_minutes: 30 }, providerName: 'nexi', ...urls,
    });
    expect((input.rowMetadata as any).booking).toEqual(booking);
  });
});
