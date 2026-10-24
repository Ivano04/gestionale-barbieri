import { fiscalStaffAccess } from '@/services/fiscal/staff-access';
import { createAdminClient } from '@/lib/supabase/admin';
import { BOOKING_UUID } from '@/lib/booking-services';
import { attendanceErrors, parseAttendanceRequest } from '@/services/attendance/validation';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const access=await fiscalStaffAccess();if(access.response)return access.response;
  const {id}=await params;if(!BOOKING_UUID.test(id))return json({error:'Appuntamento non valido'},400);
  const {data,error}=await createAdminClient().rpc('no_show_context',{p_salon:access.salonId,p_id:id});
  if(error)return json({error:attendanceErrors[error.message]??'Impossibile leggere la visita'},503);
  if(!data)return json({error:'Appuntamento non disponibile'},404);
  return json(data);
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const access=await fiscalStaffAccess();if(access.response)return access.response;
  const {id}=await params;let input;
  try { input=parseAttendanceRequest(await request.json(),id); } catch(e){return json({error:e instanceof Error?e.message:'Richiesta non valida'},400);}
  const {data,error}=await createAdminClient().rpc('change_no_show',{p_salon:access.salonId,p_actor:access.userId,p_input:input});
  if(error){const code=error.message;return json({error:attendanceErrors[code]??'Operazione non completata. Riprova la stessa richiesta.',code},code==='APPOINTMENT_NOT_FOUND'?404:attendanceErrors[code]?409:503);}
  return json(data);
}
