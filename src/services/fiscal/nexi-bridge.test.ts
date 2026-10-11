import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { linkNexiFiscalAppointment, registerNexiFiscalTest } from './nexi-bridge';

function database(appointment: string | null, linkError = false) {
  const payment = { id: 'payment', salon_id: 'salon', appointment_id: appointment };
  const updates: unknown[] = [];
  const filters: unknown[] = [];
  const from = vi.fn((table: string) => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); return query; },
      update: (value: unknown) => { updates.push(value); return query; },
      single: async () => table === 'payments'
        ? { data: payment, error: null }
        : { data: linkError ? null : { id: 'document' }, error: linkError ? {} : null },
    };
    return query;
  });
  return { db: { from } as unknown as SupabaseClient, updates, filters };
}

describe('fiscal appointment link', () => {
  it('links the same appointment on repeated notifications, scoped to salon and TEST receipt', async () => {
    const fake = database('appointment');
    await linkNexiFiscalAppointment(fake.db, 'reference');
    await linkNexiFiscalAppointment(fake.db, 'reference');
    expect(fake.updates).toEqual([{ appointment_id: 'appointment' }, { appointment_id: 'appointment' }]);
    expect(fake.filters).toContainEqual(['fiscal_documents', 'salon_id', 'salon']);
    expect(fake.filters).toContainEqual(['fiscal_documents', 'mode', 'test']);
    expect(fake.filters).toContainEqual(['fiscal_documents', 'payment_id', 'payment']);
    expect(fake.filters).toContainEqual(['fiscal_documents', 'operation', 'receipt']);
  });
  it('requires booking confirmation before updating the document', async () => {
    const fake = database(null);
    await expect(linkNexiFiscalAppointment(fake.db, 'reference')).rejects.toThrow('Confirmed fiscal appointment missing');
    expect(fake.updates).toHaveLength(0);
  });
  it('propagates a failed link so the webhook can be retried', async () => {
    const fake = database('appointment', true);
    await expect(linkNexiFiscalAppointment(fake.db, 'reference')).rejects.toThrow('Fiscal appointment link failed');
  });
});


describe('late success notification after refund', () => {
  function refundedDatabase(priorEvent: boolean) {
    const rpc = vi.fn();
    const from = (table: string) => {
      const query = { select: () => query, eq: () => query,
        single: async () => ({ data: { id: 'payment', status: 'refunded', amount_cents: 2440, metadata: { payment_environment: 'test', fiscal_receipt: { type: 'RECEIPT' } } }, error: null }),
        maybeSingle: async () => ({ data: table === 'payment_events' ? priorEvent ? { id: 'event' } : null : { id: 'original-document' }, error: null }) };
      return query;
    };
    return { db: { from, rpc } as unknown as SupabaseClient, rpc };
  }
  const event = { type: 'nexi.ok', providerRef: 'ref', status: 'succeeded' as const, amountCents: 2440, raw: { divisa: 'EUR', importo: '2440' } };
  it('acknowledges a previously verified success without undoing the refund', async () => {
    const fake = refundedDatabase(true);
    expect(await registerNexiFiscalTest(fake.db, event)).toBe('original-document');
    expect(fake.rpc).not.toHaveBeenCalled();
  });
  it('does not acknowledge success without a previous verified event', async () => {
    const fake = refundedDatabase(false);
    await expect(registerNexiFiscalTest(fake.db, event)).rejects.toThrow('not previously verified');
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});
