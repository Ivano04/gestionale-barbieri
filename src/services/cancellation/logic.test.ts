import { describe, it, expect } from 'vitest';
import { isRefundEligible, cancellationWindowHours, shouldRefundOnCancel } from './logic';

const now = new Date('2026-09-29T12:00:00Z');
const H = 60 * 60_000;

describe('isRefundEligible', () => {
  it('rimborsabile se si annulla molto prima della finestra', () => {
    expect(isRefundEligible(new Date(now.getTime() + 48 * H).toISOString(), now, 24)).toBe(true);
  });

  it('non rimborsabile se si annulla dentro la finestra', () => {
    expect(isRefundEligible(new Date(now.getTime() + 12 * H).toISOString(), now, 24)).toBe(false);
  });

  it('al confine esatto (== finestra) e\' rimborsabile', () => {
    expect(isRefundEligible(new Date(now.getTime() + 24 * H).toISOString(), now, 24)).toBe(true);
  });

  it('non rimborsabile per un appuntamento gia\' passato', () => {
    expect(isRefundEligible(new Date(now.getTime() - 1 * H).toISOString(), now, 24)).toBe(false);
  });
});

describe('cancellationWindowHours', () => {
  it('legge CANCELLATION_HOURS dall\'env', () => {
    expect(cancellationWindowHours({ CANCELLATION_HOURS: '48' })).toBe(48);
  });
  it('default 24 se assente o non valido', () => {
    expect(cancellationWindowHours({})).toBe(24);
    expect(cancellationWindowHours({ CANCELLATION_HOURS: 'abc' })).toBe(24);
  });
});

describe('shouldRefundOnCancel', () => {
  const inWindow = new Date(now.getTime() + 12 * H).toISOString();
  const outWindow = new Date(now.getTime() + 48 * H).toISOString();

  it('staff: rimborsa sempre (anche dentro la finestra)', () => {
    expect(shouldRefundOnCancel({ startIso: inWindow, now, windowHours: 24, initiatedBy: 'staff' })).toBe(true);
  });

  it('cliente fuori finestra: rimborsa', () => {
    expect(shouldRefundOnCancel({ startIso: outWindow, now, windowHours: 24, initiatedBy: 'client' })).toBe(true);
  });

  it('cliente dentro finestra: non rimborsa', () => {
    expect(shouldRefundOnCancel({ startIso: inWindow, now, windowHours: 24, initiatedBy: 'client' })).toBe(false);
  });
});
