import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({payment:{} as Record<string,unknown>,saved:null as Record<string,unknown>|null,insert:vi.fn(),duration:vi.fn(),email:vi.fn(async()=>{})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({from:(table:string)=>{
 let inserted=false;const q={select:()=>q,eq:()=>q,lt:()=>q,gt:()=>q,or:()=>q,is:()=>q,neq:()=>q,in:()=>q,
 insert:(value:Record<string,unknown>)=>{inserted=true;if(table==='appointments')m.insert(value);return q;},
 maybeSingle:async()=>({data:table==='appointments'?m.saved:null,error:null}),limit:async()=>({data:[],error:null}),
 single:async()=>({data:table==='payments'?m.payment:table==='salons'?{name:'TEST',open_time:'09:00',close_time:'19:00'}:table==='clients'?{id:'client'}:table==='appointments'?(inserted?{id:m.payment.id,...m.insert.mock.calls.at(-1)?.[0]}:{...m.insert.mock.calls.at(-1)?.[0],client:{first_name:'Test',email:'test@example.invalid'},service:{name:'Changed name'}}):null,error:null}),
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};return q;}})}));
vi.mock('@/services/booking-engine/queries',()=>({fetchServiceDuration:m.duration}));
vi.mock('@/lib/sync-webhook',()=>({sendN8nEvent:vi.fn()}));
vi.mock('@/services/ghl-sync/sync',()=>({pushToGHL:vi.fn(async()=>{})}));
vi.mock('@/services/treatwell-sync/sync',()=>({pushToTreatwell:vi.fn(async()=>{})}));
vi.mock('@/services/notifications',()=>({emailConfigFromEnv:()=>({apiKey:'test'}),createEmailProvider:()=>({})}));
vi.mock('@/services/notifications/repo',()=>({createSupabaseNotificationsRepo:()=>({})}));
vi.mock('@/services/notifications/service',()=>({sendConfirmation:m.email}));
import { POST } from '@/app/api/appointments/route';
import { buildBookingCheckoutInput } from './booking';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',payment='33333333-3333-4333-8333-333333333333';
const booking={salon_id:a,service_id:a,service_ids:[a,b],stylist_id:b,start_time:'2035-11-03T10:00:00.000Z',client:{first_name:'Test',last_name:'Cliente',phone:'+393331234567',email:'test@example.invalid'}};
const services=[{service_id:a,name:'Colore',duration_minutes:45,buffer_time_minutes:5,price_cents:4500},{service_id:b,name:'Taglio',duration_minutes:30,buffer_time_minutes:0,price_cents:2800}];
const call=(extra:Record<string,unknown>={},secret='test-internal')=>POST(new Request('https://test.local/api/appointments',{method:'POST',headers:{'x-internal-secret':secret},body:JSON.stringify({...booking,internal_payment_id:payment,...extra})}));
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('CRON_SECRET','test-internal');m.saved=null;
 const input=buildBookingCheckoutInput({booking,services,providerName:'nexi',successUrl:'https://test/ok',cancelUrl:'https://test/ko',notifyUrl:'https://test/notify'});
 m.payment={id:payment,salon_id:a,status:'succeeded',amount_cents:7300,metadata:input.rowMetadata};
 m.duration.mockRejectedValue(new Error('Never read the current catalog to confirm a paid snapshot'));
});
it('confirms a paid bundle with complete duration, extra services, one identity and all email names',async()=>{
 expect((await call()).status).toBe(201);const a=m.insert.mock.calls[0][0];
 expect(a.id).toBe(payment);expect(a.end_time).toBe('2035-11-03T11:15:00.000Z');expect(a.buffer_end_time).toBe('2035-11-03T11:20:00.000Z');
 expect(a.booked_services).toEqual(services);expect(a.added_services).toEqual([expect.objectContaining({service_id:b,name:'Taglio',duration_added:30})]);
 expect(m.duration).not.toHaveBeenCalled();expect(m.email.mock.calls[0]).toEqual([expect.objectContaining({data:expect.objectContaining({serviceName:'Colore + Taglio'})})]);
});
it('ignores modified service lists and client data in a callback body',async()=>{
 expect((await call({service_ids:[a],booked_services:[],client:{first_name:'Spoof'}})).status).toBe(201);
 expect(m.insert.mock.calls[0][0].booked_services).toEqual(services);
});
it('returns the already created appointment on duplicate callbacks without sending again',async()=>{m.saved={id:payment};expect((await call()).status).toBe(200);expect(m.insert).not.toHaveBeenCalled();expect(m.email).not.toHaveBeenCalled();});
it('rejects unauthenticated callbacks, failed payments and inconsistent paid totals',async()=>{
 expect((await call({},'bad')).status).toBe(403);m.payment.status='failed';expect((await call()).status).toBe(409);m.payment.status='succeeded';m.payment.amount_cents=1;expect((await call()).status).toBe(409);expect(m.insert).not.toHaveBeenCalled();
});
