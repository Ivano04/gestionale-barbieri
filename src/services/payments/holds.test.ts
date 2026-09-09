import { describe, it, expect } from 'vitest';
import { activeHoldsToBlocks, HOLD_TTL_MS } from './holds';

const now = new Date('2026-09-09T10:00:00Z');

function holdRow(overrides: any = {}) {
  return {
    status: 'pending',
    created_at: new Date(now.getTime() - 60_000).toISOString(), // 1 min fa
    metadata: { slot: { stylist_id: 'st1', start_time: '2026-09-09T11:00:00Z', end_time: '2026-09-09T11:30:00Z' } },
    ...overrides,
  };
}

describe('activeHoldsToBlocks', () => {
  it('include un blocco pending recente come slot occupato', () => {
    const blocks = activeHoldsToBlocks([holdRow()], now);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].stylist_id).toBe('st1');
    expect(blocks[0].start_time.toISOString()).toBe('2026-09-09T11:00:00.000Z');
    expect(blocks[0].end_time.toISOString()).toBe('2026-09-09T11:30:00.000Z');
  });

  it('esclude i blocchi scaduti (oltre il TTL)', () => {
    const expired = holdRow({ created_at: new Date(now.getTime() - HOLD_TTL_MS - 1000).toISOString() });
    expect(activeHoldsToBlocks([expired], now)).toHaveLength(0);
  });

  it('esclude i pagamenti non piu\' pending (succeeded/failed)', () => {
    expect(activeHoldsToBlocks([holdRow({ status: 'succeeded' })], now)).toHaveLength(0);
    expect(activeHoldsToBlocks([holdRow({ status: 'failed' })], now)).toHaveLength(0);
  });

  it('esclude le righe senza dati di slot nei metadata', () => {
    expect(activeHoldsToBlocks([holdRow({ metadata: { booking: {} } })], now)).toHaveLength(0);
  });
});
