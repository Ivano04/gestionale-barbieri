import { expect, it } from 'vitest';
import { parseAttendanceRequest } from './validation';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request = { requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', action: 'mark', ids: [id], expected: [{ id, updatedAt: '2026-10-24T15:00:00.123456Z' }] };
it('canonicalizes IDs and removes untrusted identity while preserving timestamp precision', () => {
  const result = parseAttendanceRequest({ ...request, ids: [id.toUpperCase()], actorId: 'spoofed', salonId: 'spoofed' }, id);
  expect(result.ids).toEqual([id]); expect(result).not.toHaveProperty('actorId'); expect(result).not.toHaveProperty('salonId');
  expect(result.expected[0].updatedAt).toBe(request.expected[0].updatedAt);
});
it.each([{ ids: [] }, { ids: [id, id] }, { action: 'charge' }, { expected: [] }, { expected: [{ id, updatedAt: 'invalid' }] }])('rejects malformed selections %j', patch => {
  expect(() => parseAttendanceRequest({ ...request, ...patch }, id)).toThrow();
});
