import { fiscalStaffAccess } from '@/services/fiscal/staff-access';
import { json } from '@/services/checkout/repo';
export async function GET(request: Request) {
 const access=await fiscalStaffAccess();if(access.response)return access.response;
 const page=Math.max(0,Math.min(10000,Number.parseInt(new URL(request.url).searchParams.get('page')??'0',10)||0));
 const {data,error,count}=await access.db.from('appointment_quotes').select('id,appointment_id,number,version,status,amount_cents,valid_until,updated_at,snapshot',{count:'exact'}).eq('salon_id',access.salonId).order('updated_at',{ascending:false}).order('id').range(page*25,page*25+24);
 if(error)return json({error:'Impossibile caricare i preventivi'},503);
 return json({quotes:(data??[]).map(({snapshot,...quote})=>({...quote,clientName:snapshot?.clientName??'Cliente'})),total:count??0});
}
