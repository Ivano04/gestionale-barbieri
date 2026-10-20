import { describe, it, expect } from 'vitest';
import { bookingServiceIds, clientServiceDuration, snapshotServices, appointmentServiceName } from '@/lib/booking-services';
import { parseBookingRequest } from './booking-request';
import { buildBookingCheckoutInput } from './booking';
import { paidBookingServices } from './paid-booking';
import { buildSalonReceipt, parseBasket } from '@/services/checkout/basket';
import { appointmentBusyPeriods, generateSlots } from '@/services/booking-engine/overlap';
import { activeHoldsToBlocks } from './holds';
import { resolveAppointmentTiming } from '@/services/appointments/timing';
const ids = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const rows = [{ id: ids[0], name: 'Colore', duration_minutes: 45, duration_application: 0, duration_processing: 0, duration_finishing: 0, price_cents: 4500, buffer_time_minutes: 5 },
  { id: ids[1], name: 'Taglio', duration_minutes: 30, price_cents: 2800, buffer_time_minutes: 0 }];
const services = snapshotServices(ids, rows);
const raw = { salon_id: ids[0], service_id: ids[0], service_ids: ids, stylist_id: ids[1], start_time: '2026-11-03T11:00:00+01:00', client: { first_name: 'Test', last_name: 'Cliente', phone: '+393331234567', email: 'test@example.invalid' } };
const booking = parseBookingRequest(raw, new Date('2026-10-20').getTime());
const input = () => buildBookingCheckoutInput({ booking, services, providerName: 'nexi', successUrl: 'https://test/ok', cancelUrl: 'https://test/ko', notifyUrl: 'https://test/notify' });
describe('widget service bundles', () => {
  it('uses the main duration when all phase values are zero or null', () => {
    expect(clientServiceDuration(rows[0])).toBe(45);
    expect(clientServiceDuration({ duration_minutes: 30, duration_application: null })).toBe(30);
  });
  it('uses actual positive phases consistently', () => expect(clientServiceDuration({ duration_minutes: 30, duration_application: 15, duration_processing: 30, duration_finishing: 15 })).toBe(60));
  it('rejects duplicate, invalid, empty, oversized and mismatched selections', () => {
    for (const value of [[], [ids[0],ids[0]], ['bad'], Array(11).fill(ids[0])]) expect(() => bookingServiceIds(value)).toThrow();
    expect(() => bookingServiceIds(ids, ids[1])).toThrow();
    expect(bookingServiceIds(undefined, ids[0])).toEqual([ids[0]]);
  });
  it('does not substitute other salon services and validates duration and prices', () => {
    expect(() => snapshotServices(ids, [rows[0]])).toThrow();
    expect(() => snapshotServices(ids, [{ ...rows[0], duration_minutes: 0 }, rows[1]])).toThrow();
    expect(() => snapshotServices(ids, [{ ...rows[0], price_cents: -1 }, rows[1]])).toThrow();
  });
  it('keeps selected order regardless of database row order', () => expect(snapshotServices(ids, [...rows].reverse()).map(s => s.service_id)).toEqual(ids));
  it('ignores spoofed client snapshots, internal payment IDs, totals and client IDs', () => {
    const clean = parseBookingRequest({ ...raw, internal_payment_id: ids[0], booked_services: [], client_id: ids[1], amountCents: 1, client: { ...raw.client, salon_id: ids[1] } }, new Date('2026-10-20').getTime());
    expect(clean).toEqual(booking);
  });
  it('rejects past/invalid times, missing timezone and invalid customer data', () => {
    for (const start_time of ['invalid','2020-01-01T10:00:00Z','2026-11-03T10:00:00','2026-11-03T10:00:01Z']) expect(() => parseBookingRequest({ ...raw,start_time }, new Date('2026-10-20').getTime())).toThrow();
    expect(() => parseBookingRequest({ ...raw,client: { ...raw.client,email:'bad' } }, new Date('2026-10-20').getTime())).toThrow();
  });
  it('creates one payment and reserves 75 minutes plus a 5 minute buffer', () => {
    const data = input(); expect(data.amountCents).toBe(7300);
    expect(data.rowMetadata?.slot).toEqual({ stylist_id: ids[1], start_time:'2026-11-03T10:00:00.000Z',end_time:'2026-11-03T11:20:00.000Z' });
    expect(data.productName).toBe('Colore + Taglio');
  });
  it('uses the paid snapshot even after the catalog is edited', () => {
    const data = input(); rows[0].price_cents = 9000;
    expect(paidBookingServices(data.rowMetadata!,7300)).toEqual(services);
    rows[0].price_cents = 4500;
    expect(() => paidBookingServices(data.rowMetadata!, 1)).toThrow();
    expect(() => paidBookingServices({ ...data.rowMetadata, slot: { ...(data.rowMetadata!.slot as object),end_time:'2026-11-03T10:30:00Z' } },7300)).toThrow();
    expect(paidBookingServices({ booking:raw },2800)).toEqual([]);
  });
  it('emits one card receipt with both lines and matching gross/net/VAT totals', () => {
    const receipt = buildSalonReceipt(parseBasket(services.map(s => ({ description:s.name,quantity:1,unitPriceCents:s.price_cents,discountCents:0 }))), 'TEST-123456789ABCDEF',22,'card');
    expect(receipt.entries.map(e => e.data.text)).toEqual(['Colore','Taglio']);
    expect(receipt.totals.vat.inclusive).toBe('73.00');
    expect(receipt.payments).toHaveLength(1);
    expect(receipt.payments[0]).toMatchObject({ type:'CARD',details:{amount:'73.00'} });
    expect(Number(receipt.totals.vat.amount)+Number(receipt.totals.vat.exclusive)).toBe(73);
  });
  it('does not free the second service or processing time inside a bundle', () => {
    const a = { start_time:'2026-11-03T10:00:00Z',end_time:'2026-11-03T11:15:00Z',buffer_end_time:'2026-11-03T11:20:00Z',booked_services:services };
    const busy = appointmentBusyPeriods(a, { duration_application:10,duration_processing:30,duration_finishing:5 });
    expect(busy).toEqual([{start:new Date(a.start_time),end:new Date(a.buffer_end_time)}]);
    const slots = generateSlots({ sStart:new Date('2026-11-03T09:00:00Z'),sEnd:new Date('2026-11-03T12:00:00Z'),duration:80,step:15,occupied:[{stylist_id:ids[1],start_time:new Date(a.start_time),end_time:new Date(a.buffer_end_time),busyPeriods:busy}],stylistId:ids[1],stylistName:'Test' });
    expect(slots).toEqual([]);
  });
  it('legacy phase appointments keep processing free but reserve their buffer', () => {
    const a = {start_time:'2026-11-03T10:00:00Z',end_time:'2026-11-03T10:50:00Z',buffer_end_time:'2026-11-03T10:55:00Z'};
    const busy = appointmentBusyPeriods(a,{duration_application:10,duration_processing:30,duration_finishing:10});
    expect(busy).toHaveLength(3); expect(busy[1].start.toISOString()).toBe('2026-11-03T10:40:00.000Z');
    expect(busy[2].end.toISOString()).toBe('2026-11-03T10:55:00.000Z');
  });
  it('retains paid slots during confirmation recovery, releases expired pending holds', () => {
    const data=input(); const old=new Date(Date.now()-3600000).toISOString();
    expect(activeHoldsToBlocks([{status:'succeeded',appointment_id:null,created_at:old,metadata:data.rowMetadata}],new Date())).toHaveLength(1);
    expect(activeHoldsToBlocks([{status:'pending',created_at:old,metadata:data.rowMetadata}],new Date())).toHaveLength(0);
  });
  it('moving the bundle preserves total duration and buffer', () => {
    const moved = resolveAppointmentTiming({ service_id:ids[0],start_time:booking.start_time,end_time:'2026-11-03T11:15:00Z',buffer_end_time:'2026-11-03T11:20:00Z' },{start_time:'2026-11-04T14:00:00Z'});
    expect(moved.end_time).toBe('2026-11-04T15:15:00.000Z');expect(moved.buffer_end_time).toBe('2026-11-04T15:20:00.000Z');
  });
  it('lists every service in customer emails and calendar captions', () => expect(appointmentServiceName({ service:{name:'Changed catalog name'},booked_services:services,added_services:[{name:'Taglio'}] })).toBe('Colore + Taglio'));
});
