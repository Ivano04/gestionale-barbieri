import { describe, it, expect } from 'vitest';
import { refundPayment } from './refund';

function makeFakeProvider() {
  const calls: any = { refund: [] };
  return {
    calls,
    createCheckout: async () => ({ url: '', providerRef: '' }),
    verifyWebhook: () => { throw new Error('n/a'); },
    refund: async (ref: string, amount?: number) => { calls.refund.push({ ref, amount }); },
  };
}

function makeFakeRepo(row: any) {
  const calls: any = { updateByProviderRef: [] };
  return {
    calls,
    insertPending: async () => ({ id: 'x' }),
    getByProviderRef: async () => row,
    updateByProviderRef: async (ref: string, patch: any) => { calls.updateByProviderRef.push({ ref, patch }); },
  };
}

const paidRow = { id: 'p1', appointment_id: 'a1', status: 'succeeded', metadata: {}, provider_payment_id: 'ORDER1', amount_cents: 2500 };

describe('refundPayment', () => {
  it('rimborsa l\'importo e segna il pagamento refunded', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo(paidRow);

    await refundPayment({ provider: provider as any, repo: repo as any, providerRef: 'ORDER1' });

    expect(provider.calls.refund[0]).toEqual({ ref: 'ORDER1', amount: 2500 });
    expect(repo.calls.updateByProviderRef[0]).toMatchObject({ ref: 'ORDER1', patch: { status: 'refunded' } });
  });

  it('e\' idempotente: se gia\' refunded non richiama lo storno', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo({ ...paidRow, status: 'refunded' });

    await refundPayment({ provider: provider as any, repo: repo as any, providerRef: 'ORDER1' });

    expect(provider.calls.refund).toHaveLength(0);
  });

  it('lancia se il pagamento non esiste', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo(null);

    await expect(refundPayment({ provider: provider as any, repo: repo as any, providerRef: 'NOPE' })).rejects.toThrow();
  });
});
