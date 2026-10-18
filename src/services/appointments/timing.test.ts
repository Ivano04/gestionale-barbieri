import { describe, expect, it } from 'vitest';
import { resolveAppointmentTiming } from './timing';
const original = { service_id: 'service', start_time: '2035-01-16T10:00:00+01:00', end_time: '2035-01-16T10:45:00+01:00', buffer_end_time: '2035-01-16T10:55:00+01:00' };
describe('calendar appointment timing', () => {
  it('moves the buffer together with a drag that supplies start and end', () => {
    expect(resolveAppointmentTiming(original, { start_time: '2035-01-16T11:00:00+01:00', end_time: '2035-01-16T11:45:00+01:00' })).toEqual({ start_time: '2035-01-16T10:00:00.000Z', end_time: '2035-01-16T10:45:00.000Z', buffer_end_time: '2035-01-16T10:55:00.000Z' });
  });
  it('preserves booked duration for a week-view move that only supplies start', () => {
    const moved=resolveAppointmentTiming(original,{start_time:'2035-01-17T08:00:00+01:00'});
    expect(moved.end_time).toBe('2035-01-17T07:45:00.000Z'); expect(moved.buffer_end_time).toBe('2035-01-17T07:55:00.000Z');
  });
  it('recalculates stale end fields posted by the expanded appointment form', () => {
    const moved=resolveAppointmentTiming(original,{...original,start_time:'2035-01-16T12:00:00+01:00'});
    expect(moved.end_time).toBe('2035-01-16T11:45:00.000Z');expect(moved.buffer_end_time).toBe('2035-01-16T11:55:00.000Z');
  });
  it('preserves buffer when resizing',()=>{expect(resolveAppointmentTiming(original,{end_time:'2035-01-16T11:00:00+01:00'}).buffer_end_time).toBe('2035-01-16T10:10:00.000Z');});
  it('handles appointments without a buffer',()=>{const moved=resolveAppointmentTiming({...original,buffer_end_time:null},{start_time:'2035-01-17T10:00:00+01:00'});expect(moved.buffer_end_time).toBe(moved.end_time);});
  it('repairs an old stale buffer instead of carrying a negative buffer forward',()=>{const moved=resolveAppointmentTiming({...original,buffer_end_time:original.start_time},{start_time:'2035-01-17T10:00:00+01:00'});expect(moved.buffer_end_time).toBe(moved.end_time);});
  it('uses the new service duration when changing service',()=>{const moved=resolveAppointmentTiming(original,{...original,service_id:'new'},{duration_minutes:30,buffer_time_minutes:5});expect(moved.end_time).toBe('2035-01-16T09:30:00.000Z');expect(moved.buffer_end_time).toBe('2035-01-16T09:35:00.000Z');});
  it('rejects invalid dates and non-positive duration',()=>{expect(()=>resolveAppointmentTiming(original,{start_time:'invalid'})).toThrow();expect(()=>resolveAppointmentTiming(original,{end_time:original.start_time})).toThrow();});
  it('rejects a manually supplied buffer before the end',()=>{expect(()=>resolveAppointmentTiming(original,{buffer_end_time:'2035-01-16T10:30:00+01:00'})).toThrow();});
});
