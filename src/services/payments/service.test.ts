import { describe, it, expect } from 'vitest';
import { createPaymentCheckout } from './service';

function makeFakeProvider() {
  const calls: any = { createCheckout: [] };
  return {
    calls,
    createCheckout: async (params: any) => {
      calls.createCheckout.push(params);
      return { url: 'https://pay/redirect', providerRef: 'ref_123', method: 'POST', fields: { mac: 'abc', importo: '2500' } };
    },
    verifyWebhook: () => { throw new Error('n/a'); },
    refund: async () => {},
  };
}

function makeFakeRepo() {
  const calls: any = { insertPending: [] };
  return {
    calls,
    insertPending: async (row: any) => { calls.insertPending.push(row); return { id: 'pay_1' }; },
    updateByProviderRef: async () => {},
  };
}

const baseInput = {
  salonId: 'salon_1',
  amountCents: 2500,
  providerName: 'stripe' as const,
  successUrl: 'https://app/ok',
  cancelUrl: 'https://app/ko',
};

describe('createPaymentCheckout', () => {
  it('restituisce l\'URL di pagamento del provider', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo();

    const result = await createPaymentCheckout({ provider: provider as any, repo: repo as any, input: baseInput });

    expect(result.url).toBe('https://pay/redirect');
  });

  it('inoltra method e fields del provider (necessari per il form POST di Nexi)', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo();

    const result = await createPaymentCheckout({ provider: provider as any, repo: repo as any, input: baseInput });

    expect(result.method).toBe('POST');
    expect(result.fields).toEqual({ mac: 'abc', importo: '2500' });
    expect(result.providerRef).toBe('ref_123');
  });

  it('salva una riga payments in stato pending col riferimento del provider', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo();

    await createPaymentCheckout({ provider: provider as any, repo: repo as any, input: baseInput });

    const row = repo.calls.insertPending[0];
    expect(row.salon_id).toBe('salon_1');
    expect(row.provider).toBe('stripe');
    expect(row.provider_payment_id).toBe('ref_123');
    expect(row.amount_cents).toBe(2500);
    expect(row.status).toBe('pending');
  });

  it('inoltra notifyUrl al provider (usato da Nexi per urlpost)', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo();

    await createPaymentCheckout({
      provider: provider as any,
      repo: repo as any,
      input: { ...baseInput, notifyUrl: 'https://app/notify' },
    });

    expect(provider.calls.createCheckout[0].notifyUrl).toBe('https://app/notify');
  });

  it('rifiuta importi non positivi senza chiamare il provider', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo();

    await expect(
      createPaymentCheckout({ provider: provider as any, repo: repo as any, input: { ...baseInput, amountCents: 0 } }),
    ).rejects.toThrow();
    expect(provider.calls.createCheckout).toHaveLength(0);
  });
});
