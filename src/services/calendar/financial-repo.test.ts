import { it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { attachCalendarFinance } from './financial-repo';
function database(fail?: string) {
  const calls: { table: string; salon?: string; ids?: string[]; columns?: string }[] = [];
  const db = { from(table: string) {
    const call = { table } as typeof calls[number]; calls.push(call);
    const q = {
      select(columns: string) { call.columns = columns; return q; },
      eq(key: string, value: string) { expect(key).toBe('salon_id'); call.salon = value; return q; },
      in(key: string, ids: string[]) { expect(key).toBe('appointment_id'); call.ids = ids; return q; },
      async range() { return { error: table === fail ? { message: 'private DB error' } : null, data: table === 'payments' ? [{ appointment_id: 'a', status: 'succeeded', amount_cents: 2800 }] : [] }; },
    }; return q;
  } } as unknown as SupabaseClient;
  return { db, calls };
}
it('scopes every batch by authenticated RLS client, salon and loaded appointment ids', async () => {
  const { db, calls } = database();
  const result = await attachCalendarFinance(db, 'salon', [{ id: 'a', source: 'widget' }, { id: 'b', source: 'phone' }]);
  expect(calls).toHaveLength(4);
  for (const call of calls) { expect(call.salon).toBe('salon'); expect(call.ids).toEqual(['a', 'b']); expect(call.columns).not.toContain('*'); expect(call.columns).not.toContain('metadata'); }
  expect(result.map(a => a.finance.payment)).toEqual(['online', 'unpaid']);
});
it('keeps appointments and payment when fiscal reads fail', async () => {
  const { db } = database('fiscal_documents');
  const [result] = await attachCalendarFinance(db, 'salon', [{ id: 'a', source: 'widget' }]);
  expect(result.finance).toMatchObject({ payment: 'online', receipt: 'unknown' });
  expect(JSON.stringify(result)).not.toContain('private DB error');
});
it('batches large calendars and skips reads for empty calendars', async () => {
  const { db, calls } = database();
  await attachCalendarFinance(db, 'salon', []); expect(calls).toHaveLength(0);
  const apps = Array.from({ length: 51 }, (_, i) => ({ id: `a${i}`, source: 'manual' }));
  expect(await attachCalendarFinance(db, 'salon', apps)).toHaveLength(51);
  expect(calls).toHaveLength(8); expect(calls[0].ids).toHaveLength(50); expect(calls[4].ids).toHaveLength(1);
});
