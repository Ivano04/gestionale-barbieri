import { describe, it, expect } from 'vitest';
import { createSupabasePaymentsRepo } from './repo';

function makeFakeSupabase(row: any = null) {
  const calls: any = { from: [], insert: [], update: [], eq: [], select: [] };
  const builder: any = {
    insert(r: any) { calls.insert.push(r); return builder; },
    update(patch: any) { calls.update.push(patch); return builder; },
    select(cols?: string) { calls.select.push(cols); return builder; },
    eq(col: string, val: any) { calls.eq.push({ col, val }); return builder; },
    single() { return Promise.resolve({ data: { id: 'pay_99' }, error: null }); },
    maybeSingle() { return Promise.resolve({ data: row, error: null }); },
    // rende il builder "awaitable" per update().eq()
    then(resolve: any) { return Promise.resolve({ error: null }).then(resolve); },
  };
  return { calls, from(t: string) { calls.from.push(t); return builder; } };
}

describe('createSupabasePaymentsRepo', () => {
  it('insertPending inserisce nella tabella payments e ritorna il nuovo id', async () => {
    const sb = makeFakeSupabase();
    const repo = createSupabasePaymentsRepo(sb as any);

    const res = await repo.insertPending({
      salon_id: 's1', provider: 'nexi', provider_payment_id: 'ORDER1',
      amount_cents: 2500, currency: 'EUR', status: 'pending',
    });

    expect(sb.calls.from[0]).toBe('payments');
    expect(sb.calls.insert[0].provider_payment_id).toBe('ORDER1');
    expect(res.id).toBe('pay_99');
  });

  it('updateByProviderRef aggiorna la riga filtrando per provider_payment_id', async () => {
    const sb = makeFakeSupabase();
    const repo = createSupabasePaymentsRepo(sb as any);

    await repo.updateByProviderRef('ORDER1', { status: 'succeeded' });

    expect(sb.calls.from[0]).toBe('payments');
    expect(sb.calls.update[0].status).toBe('succeeded');
    expect(sb.calls.eq[0]).toEqual({ col: 'provider_payment_id', val: 'ORDER1' });
  });

  it('getByProviderRef legge la riga per provider_payment_id', async () => {
    const sb = makeFakeSupabase({ id: 'pay_7', appointment_id: null, status: 'pending', metadata: { booking: {} } });
    const repo = createSupabasePaymentsRepo(sb as any);

    const row = await repo.getByProviderRef('ORDER1');

    expect(sb.calls.from[0]).toBe('payments');
    expect(sb.calls.eq[0]).toEqual({ col: 'provider_payment_id', val: 'ORDER1' });
    expect(row?.id).toBe('pay_7');
  });

  it('getByProviderRef ritorna null se la riga non esiste', async () => {
    const sb = makeFakeSupabase(null);
    const repo = createSupabasePaymentsRepo(sb as any);
    expect(await repo.getByProviderRef('NOPE')).toBeNull();
  });
});
