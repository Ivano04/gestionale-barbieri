import { expect, it } from 'vitest';
import { appointmentOccupiedEnd } from '@/lib/appointment-time';
import { appointmentBusyPeriods, isSlotFree } from './overlap';

const a = { start_time: '2026-10-28T16:00:00Z', end_time: '2026-10-28T17:00:00Z' };
const phases = { duration_application: 15, duration_processing: 30, duration_finishing: 15 };
it.each([undefined, null, '2026-07-07T10:45:00Z', a.start_time, '2026-10-28T16:30:00Z', 'invalid'])(
  'a missing or stale buffer (%s) cannot shorten the booked service', buffer_end_time => {
    const appointment = { ...a, buffer_end_time };
    expect(appointmentOccupiedEnd(appointment)).toEqual(new Date(a.end_time));
    for (const bundle of [{}, { booked_services: [{ name: 'Taglio donna' }, { name: 'Taglio Uomo' }] }, { added_services: [{ name: 'Taglio Uomo' }] }]) {
      const busyPeriods = appointmentBusyPeriods({ ...appointment, ...bundle });
      expect(busyPeriods).toEqual([{ start: new Date(a.start_time), end: new Date(a.end_time) }]);
      const occupied = [{ stylist_id: 'joe', start_time: new Date(a.start_time), end_time: appointmentOccupiedEnd(appointment), busyPeriods }];
      expect(isSlotFree('joe', new Date('2026-10-28T16:45:00Z'), new Date('2026-10-28T17:15:00Z'), occupied)).toBe(false);
      expect(isSlotFree('joe', new Date(a.end_time), new Date('2026-10-28T18:00:00Z'), occupied)).toBe(true);
    }
  });
it('retains a valid cleanup buffer after the service', () => {
  const appointment = { ...a, buffer_end_time: '2026-10-28T17:15:00Z' };
  expect(appointmentOccupiedEnd(appointment)).toEqual(new Date(appointment.buffer_end_time));
  expect(appointmentBusyPeriods(appointment)).toEqual([{ start: new Date(a.start_time), end: new Date(appointment.buffer_end_time) }]);
  expect(appointmentBusyPeriods(appointment, { duration_application: 0, duration_processing: 0, duration_finishing: 0 })).toEqual([{ start: new Date(a.start_time), end: new Date(appointment.buffer_end_time) }]);
});
it('keeps processing free and finishing busy with a stale buffer', () => {
  const appointment = { ...a, buffer_end_time: '2026-10-28T14:00:00Z' };
  const occupied = [{ stylist_id: 'joe', start_time: new Date(a.start_time), end_time: appointmentOccupiedEnd(appointment), busyPeriods: appointmentBusyPeriods(appointment, phases) }];
  expect(isSlotFree('joe', new Date('2026-10-28T16:15:00Z'), new Date('2026-10-28T16:45:00Z'), occupied)).toBe(true);
  expect(isSlotFree('joe', new Date('2026-10-28T16:45:00Z'), new Date(a.end_time), occupied)).toBe(false);
});
