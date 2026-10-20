import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(() => ({ salon:vi.fn(),duration:vi.fn(),stylists:vi.fn(),occupied:vi.fn(),catalog:vi.fn() }));
vi.mock('./queries', () => ({ fetchSalonHours:mock.salon,fetchServiceDuration:mock.duration,fetchStylists:mock.stylists,fetchOccupiedSlots:mock.occupied }));
vi.mock('./catalog', () => ({fetchBookingServices:mock.catalog}));
import {getAvailableSlots} from './index';
const input={salon_id:'salon',service_id:'first',service_ids:['first','second'],date:'2026-11-03'};
beforeEach(() => {
  vi.clearAllMocks();mock.salon.mockResolvedValue([{open:'09:00',close:'11:00'}]);
  mock.stylists.mockResolvedValue([{id:'stylist',full_name:'Test',working_hours:{tue:[{open:'08:00',close:'12:00'}]}}]);mock.occupied.mockResolvedValue([]);
  mock.catalog.mockResolvedValue([{duration_minutes:45,buffer_time_minutes:5},{duration_minutes:30,buffer_time_minutes:0}]);
});
describe('combined availability',()=>{
 it('fits the entire 80 minute reservation inside salon and stylist shifts',async()=>{
  const slots=await getAvailableSlots(input);expect(slots.map(s=>s.time)).toEqual(['09:00','09:15','09:30']);
  expect(mock.stylists).toHaveBeenCalledWith('salon',undefined,['first','second']);
 });
 it('does not cross the lunch break',async()=>{
  mock.salon.mockResolvedValue([{open:'09:00',close:'10:00'},{open:'11:00',close:'12:00'}]);expect(await getAvailableSlots(input)).toEqual([]);
 });
 it('checks conflict at the end of the last service',async()=>{
  mock.occupied.mockResolvedValue([{stylist_id:'stylist',start_time:new Date('2026-11-03T09:00:00Z'),end_time:new Date('2026-11-03T10:00:00Z')}]);expect(await getAvailableSlots(input)).toEqual([]);
 });
 it('preserves booked duration while rescheduling even when the catalog changes',async()=>{
  await getAvailableSlots({...input,duration_minutes:80,exclude_appointment_id:'appt'});
  expect(mock.catalog).not.toHaveBeenCalled();expect(mock.occupied.mock.calls[0][3]).toBe('appt');
 });
 it('does not offer slots without a qualified stylist or after query failure',async()=>{
  mock.stylists.mockResolvedValue([]);expect(await getAvailableSlots(input)).toEqual([]);
  mock.stylists.mockRejectedValue(new Error('database unavailable'));await expect(getAvailableSlots(input)).rejects.toThrow();
 });
});
