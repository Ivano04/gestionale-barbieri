import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ update: vi.fn(), event: vi.fn(), error: null as {code:string;message:string}|null }));
const existing={id:'appointment',client_id:'client',salon_id:'salon',stylist_id:'stylist',service_id:'service',start_time:'2035-01-16T09:00:00Z',end_time:'2035-01-16T09:45:00Z',buffer_end_time:'2035-01-16T09:55:00Z'};
vi.mock('@/lib/supabase/server',()=>({createServerSupabase:async()=>({from:()=>{
 let updated:Record<string,unknown>|undefined;
 const q={select:()=>q,eq:()=>q,lt:()=>q,gt:()=>q,or:()=>q,neq:()=>q,in:()=>q,limit:()=>q,
 update:(value:Record<string,unknown>)=>{updated=value;state.update(value);return q;},
 single:async()=>({data:updated?{...existing,...updated}:existing,error:updated?state.error:null}),
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};return q;
}})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({from:()=>{const q={select:()=>q,eq:()=>q,lt:()=>q,gt:()=>q,or:()=>q,is:()=>q,limit:async()=>({data:[]})};return q;}})}));
vi.mock('@/services/booking-engine/queries',()=>({fetchStylists:vi.fn(async()=>[{id:'stylist'}])}));
vi.mock('@/lib/sync-webhook',()=>({sendN8nEvent:state.event}));
vi.mock('@/services/ghl-sync/sync',()=>({updateGHLAppointment:vi.fn()}));
vi.mock('@/services/treatwell-sync/sync',()=>({pushUpdateToTreatwell:vi.fn()}));
vi.mock('@/services/cancellation/service',()=>({cancelAndMaybeRefund:vi.fn()}));
import {PATCH} from '@/app/api/appointments/[id]/route';
const patch=(body:unknown)=>PATCH(new Request('https://test.local/api/appointments/appointment',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:'appointment'})});
beforeEach(()=>{vi.clearAllMocks();state.error=null;});
it('persists a full drag interval including buffer',async()=>{expect((await patch({start_time:'2035-01-16T10:00:00Z',end_time:'2035-01-16T10:45:00Z',stylist_id:'stylist'})).status).toBe(200);expect(state.update).toHaveBeenCalledWith(expect.objectContaining({buffer_end_time:'2035-01-16T10:55:00.000Z'}));});
it('ignores joined records while saving the appointment form and shifts its old end',async()=>{expect((await patch({...existing,start_time:'2035-01-16T10:00:00Z',client:{first_name:'Test'},service:{name:'Taglio'}})).status).toBe(200);const saved=state.update.mock.calls[0][0];expect(saved.end_time).toBe('2035-01-16T10:45:00.000Z');expect(saved).not.toHaveProperty('client');expect(saved).not.toHaveProperty('service');expect(saved).not.toHaveProperty('salon_id');});
it('does not write malformed or reversed times',async()=>{expect((await patch({end_time:'2035-01-16T08:45:00Z'})).status).toBe(400);expect(state.update).not.toHaveBeenCalled();});
it('reports a concurrent slot conflict without notifying integrations of success',async()=>{state.error={code:'23P01',message:'Slot no longer available'};expect((await patch({start_time:'2035-01-16T10:00:00Z'})).status).toBe(409);expect(state.event).not.toHaveBeenCalled();});

it('does not silently keep the old customer when a new customer has not been created',async()=>{expect((await patch({client:{first_name:'New'}})).status).toBe(400);expect(state.update).not.toHaveBeenCalled();});
