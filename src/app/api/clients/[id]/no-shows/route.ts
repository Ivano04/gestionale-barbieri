import { fiscalStaffAccess } from '@/services/fiscal/staff-access';
import { appointmentServiceName, BOOKING_UUID } from '@/lib/booking-services';
const single = <T,>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value;
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const access=await fiscalStaffAccess();if(access.response)return access.response;
  const {id}=await params;if(!BOOKING_UUID.test(id))return Response.json({error:'Cliente non valido'},{status:400});
  const {data:client,error:clientError}=await access.db.from('clients').select('id').eq('id',id).eq('salon_id',access.salonId).maybeSingle();
  if(clientError)return Response.json({error:'Storico non disponibile'},{status:503});if(!client)return Response.json({error:'Cliente non disponibile'},{status:404});
  const [cases,emails]=await Promise.all([
    access.db.from('no_show_cases').select('id,visit_start,visit_end,visit_date,members:no_show_members(appointment_id,marked_at,restored_at,appointment:appointments(booked_services,added_services,service:services(name))),events:no_show_events(action,created_at,actor_name,actor:users(full_name))').eq('salon_id',access.salonId).eq('client_id',id).order('visit_start',{ascending:false}).limit(100),
    access.db.from('no_show_emails').select('visit_date,state,available_at,sent_at,last_error_code').eq('salon_id',access.salonId).eq('client_id',id).order('visit_date',{ascending:false}).limit(100),
  ]);
  if(cases.error||emails.error)return Response.json({error:'Storico non disponibile'},{status:503});
  return Response.json({visits:(cases.data??[]).map(c=>({...c,members:c.members.map(m=>{const appointment=single(m.appointment);return {appointment_id:m.appointment_id,marked_at:m.marked_at,restored_at:m.restored_at,serviceName:appointment ? appointmentServiceName({...appointment,service:single(appointment.service)}) : 'Servizio'};}),activeCount:c.members.filter(m=>!m.restored_at).length,email:emails.data?.find(e=>e.visit_date===c.visit_date)??null})),hasMore:cases.data?.length===100},{headers:{'Cache-Control':'private, no-store'}});
}
