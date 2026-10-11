import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { makeRescheduleToken, verifyRescheduleToken } from './token';
import { validDate, canReschedule, romeSlot } from './logic';
import { isRefundEligible, shouldRefundOnCancel } from '@/services/cancellation/logic';
const id = '11111111-1111-4111-8111-111111111111';
describe('client rescheduling authorization', () => {
  it('isolates the token from cancellation and rejects tampering or missing configuration', () => {
    const token = makeRescheduleToken(id, 'secret');
    expect(verifyRescheduleToken(token, 'secret')).toBe(id);
    expect(verifyRescheduleToken(token, '')).toBeNull();
    expect(verifyRescheduleToken(token, 'another-secret')).toBeNull();
    const cancel = id + '.' + createHmac('sha256', 'secret').update(id).digest('hex');
    expect(verifyRescheduleToken(cancel, 'secret')).toBeNull();
    expect(verifyRescheduleToken({ token }, 'secret')).toBeNull();
    expect(() => makeRescheduleToken(id, '')).toThrow();
  });
  it('rejects cancelled, completed and already started appointments', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    expect(canReschedule('confirmed', '2026-10-11T13:00:00Z', now)).toBe(true);
    expect(canReschedule('confirmed', '2026-10-11T12:00:00Z', now)).toBe(false);
    expect(canReschedule('cancelled', '2026-10-12T13:00:00Z', now)).toBe(false);
    expect(canReschedule('completed', '2026-10-12T13:00:00Z', now)).toBe(false);
  });
  it('rejects impossible dates and keeps Rome time independent of server timezone', () => {
    expect(validDate('2027-02-30', new Date('2026-10-11'))).toBe(false);
    expect(validDate('2035-01-01', new Date('2026-10-11'))).toBe(false);
    expect(romeSlot('2026-11-02', '11:00')).toBe('2026-11-02T10:00:00.000Z');
    expect(romeSlot('2027-06-02', '11:00')).toBe('2027-06-02T09:00:00.000Z');
    expect(() => romeSlot('2026-11-02', '25:00')).toThrow();
  });
  it('does not reopen an expired refund deadline after moving to a later date', () => {
    const now = new Date('2026-10-11T15:00:00Z');
    expect(isRefundEligible('2026-10-20T09:00:00Z', now, 24, '2026-10-11T09:00:00Z')).toBe(false);
    expect(shouldRefundOnCancel({ startIso: '2026-10-20T09:00:00Z', now, windowHours: 24, deadlineIso: '2026-10-11T09:00:00Z', initiatedBy: 'staff' })).toBe(true);
  });
});
