import { it, expect } from 'vitest';
import { calendarRange } from './calendar-range';
it('uses Rome boundaries with an exclusive next-day end', () => expect(calendarRange('2026-10-20')).toEqual({ start: '2026-10-19T22:00:00.000Z', end: '2026-10-20T22:00:00.000Z' }));
it('includes the full 25 hour autumn change day', () => expect(calendarRange('2026-10-25')).toEqual({ start: '2026-10-24T22:00:00.000Z', end: '2026-10-25T23:00:00.000Z' }));
it('includes the full 23 hour spring change day', () => expect(calendarRange('2026-03-29')).toEqual({ start: '2026-03-28T23:00:00.000Z', end: '2026-03-29T22:00:00.000Z' }));
it('loads all seven days of a week', () => expect(calendarRange('2026-10-19', '2026-10-25').end).toBe('2026-10-25T23:00:00.000Z'));
it.each([['2026-02-30'], ['invalid'], ['2026-10-20', '2026-10-19'], ['2026-10-20', '2026-10-27']])('rejects invalid or excessive range %j', (...args) => expect(() => calendarRange(args[0], args[1])).toThrow());
