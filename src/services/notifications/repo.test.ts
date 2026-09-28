import { describe, it, expect } from 'vitest';
import { createSupabaseNotificationsRepo } from './repo';

function makeFakeSupabase(row: any = null) {
  const calls: any = { from: [], upsert: [], eq: [], select: [] };
  const builder: any = {
    select(cols?: string) { calls.select.push(cols); return builder; },
    eq(col: string, val: any) { calls.eq.push({ col, val }); return builder; },
    maybeSingle() { return Promise.resolve({ data: row, error: null }); },
    upsert(r: any, opts: any) { calls.upsert.push({ r, opts }); return Promise.resolve({ error: null }); },
  };
  return { calls, from(t: string) { calls.from.push(t); return builder; } };
}

describe('createSupabaseNotificationsRepo', () => {
  it('alreadySent true se esiste una riga per (appuntamento, tipo)', async () => {
    const sb = makeFakeSupabase({ id: 'n1' });
    const repo = createSupabaseNotificationsRepo(sb as any);
    expect(await repo.alreadySent('a1', 'confirmation')).toBe(true);
    expect(sb.calls.from[0]).toBe('notifications');
    expect(sb.calls.eq).toEqual([{ col: 'appointment_id', val: 'a1' }, { col: 'type', val: 'confirmation' }]);
  });

  it('alreadySent false se non esiste', async () => {
    const sb = makeFakeSupabase(null);
    const repo = createSupabaseNotificationsRepo(sb as any);
    expect(await repo.alreadySent('a1', 'reminder')).toBe(false);
  });

  it('markSent fa upsert su notifications con status sent', async () => {
    const sb = makeFakeSupabase();
    const repo = createSupabaseNotificationsRepo(sb as any);
    await repo.markSent({ salon_id: 's1', appointment_id: 'a1', type: 'confirmation' });
    const up = sb.calls.upsert[0];
    expect(sb.calls.from[0]).toBe('notifications');
    expect(up.r).toMatchObject({ salon_id: 's1', appointment_id: 'a1', type: 'confirmation', status: 'sent' });
    expect(up.opts).toMatchObject({ onConflict: 'appointment_id,type', ignoreDuplicates: true });
  });
});
