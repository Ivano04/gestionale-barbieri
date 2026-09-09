import { describe, it, expect } from 'vitest';
import { StripeProvider } from './stripe';

// Client Stripe finto: registra gli argomenti ricevuti e restituisce risposte note.
function makeFakeStripe(overrides: any = {}) {
  const calls: any = { sessionsCreate: [], refundsCreate: [], constructEvent: [] };
  return {
    calls,
    checkout: {
      sessions: {
        create: async (params: any) => {
          calls.sessionsCreate.push(params);
          return { id: 'cs_test_123', url: 'https://checkout.stripe.com/pay/cs_test_123', ...overrides.session };
        },
      },
    },
    refunds: {
      create: async (params: any) => {
        calls.refundsCreate.push(params);
        return { id: 're_test_1' };
      },
    },
    webhooks: {
      constructEvent: (body: string, sig: string, secret: string) => {
        calls.constructEvent.push({ body, sig, secret });
        if (overrides.constructEventThrows) throw new Error('Invalid signature');
        return overrides.event;
      },
    },
  };
}

describe('StripeProvider.createCheckout', () => {
  it('restituisce url e providerRef dalla sessione creata', async () => {
    const stripe = makeFakeStripe();
    const provider = new StripeProvider(stripe as any, 'whsec_test');

    const result = await provider.createCheckout({
      amountCents: 2500,
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/ko',
    });

    expect(result.url).toBe('https://checkout.stripe.com/pay/cs_test_123');
    expect(result.providerRef).toBe('cs_test_123');
  });

  it('invia a Stripe l\'importo in centesimi senza conversioni e in EUR di default', async () => {
    const stripe = makeFakeStripe();
    const provider = new StripeProvider(stripe as any, 'whsec_test');

    await provider.createCheckout({
      amountCents: 2500,
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/ko',
    });

    const sent = stripe.calls.sessionsCreate[0];
    const lineItem = sent.line_items[0];
    expect(lineItem.price_data.unit_amount).toBe(2500);
    expect(lineItem.price_data.currency).toBe('eur');
    expect(sent.mode).toBe('payment');
  });
});

describe('StripeProvider.verifyWebhook', () => {
  it('verifica la firma col webhook secret e normalizza una sessione completata come "succeeded"', () => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123', amount_total: 2500, payment_status: 'paid' } },
    };
    const stripe = makeFakeStripe({ event });
    const provider = new StripeProvider(stripe as any, 'whsec_secret');

    const result = provider.verifyWebhook('raw-body', 'sig-header');

    // la firma e' stata verificata col secret giusto
    expect(stripe.calls.constructEvent[0]).toEqual({ body: 'raw-body', sig: 'sig-header', secret: 'whsec_secret' });
    // evento normalizzato
    expect(result.type).toBe('checkout.session.completed');
    expect(result.providerRef).toBe('cs_test_123');
    expect(result.amountCents).toBe(2500);
    expect(result.status).toBe('succeeded');
  });

  it('propaga l\'eccezione se la firma non e\' valida', () => {
    const stripe = makeFakeStripe({ constructEventThrows: true });
    const provider = new StripeProvider(stripe as any, 'whsec_secret');

    expect(() => provider.verifyWebhook('raw-body', 'bad-sig')).toThrow();
  });

  it('mappa una sessione scaduta come "canceled"', () => {
    const event = { type: 'checkout.session.expired', data: { object: { id: 'cs_x', amount_total: 1000 } } };
    const stripe = makeFakeStripe({ event });
    const provider = new StripeProvider(stripe as any, 'whsec_secret');

    expect(provider.verifyWebhook('b', 's').status).toBe('canceled');
  });

  it('mappa un rimborso (charge.refunded) come "refunded"', () => {
    const event = { type: 'charge.refunded', data: { object: { id: 'ch_1', amount: 2500 } } };
    const stripe = makeFakeStripe({ event });
    const provider = new StripeProvider(stripe as any, 'whsec_secret');

    const result = provider.verifyWebhook('b', 's');
    expect(result.status).toBe('refunded');
    expect(result.amountCents).toBe(2500);
  });
});

describe('StripeProvider.refund', () => {
  it('rimborsa l\'intero pagamento sul payment_intent quando non e\' dato un importo', async () => {
    const stripe = makeFakeStripe();
    const provider = new StripeProvider(stripe as any, 'whsec_secret');

    await provider.refund('pi_1');

    const sent = stripe.calls.refundsCreate[0];
    expect(sent.payment_intent).toBe('pi_1');
    expect(sent.amount).toBeUndefined();
  });

  it('rimborsa un importo parziale quando specificato', async () => {
    const stripe = makeFakeStripe();
    const provider = new StripeProvider(stripe as any, 'whsec_secret');

    await provider.refund('pi_1', 1000);

    const sent = stripe.calls.refundsCreate[0];
    expect(sent.payment_intent).toBe('pi_1');
    expect(sent.amount).toBe(1000);
  });
});
