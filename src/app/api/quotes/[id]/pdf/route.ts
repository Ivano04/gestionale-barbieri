import { createAdminClient } from '@/lib/supabase/admin';
import { fiscalStaffAccess } from '@/services/fiscal/staff-access';
import { json, UUID } from '@/services/checkout/repo';
import { quotePdf } from '@/services/checkout/quote-pdf';
import type { AppointmentQuote } from '@/services/checkout/types';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
 const access = await fiscalStaffAccess(); if(access.response)return access.response;
 const {id}=await params; if(!UUID.test(id))return json({error:'Identificativo non valido'},400);
 const {data,error}=await createAdminClient().from('appointment_quotes').select('*').eq('id',id).eq('salon_id',access.salonId).maybeSingle();
 if(error)return json({error:'Preventivo non disponibile'},503); if(!data)return json({error:'Preventivo non trovato'},404);
 try { const bytes=await quotePdf(data as AppointmentQuote); return new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="preventivo-${data.number}-v${data.version}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}); }
 catch {return json({error:'Impossibile preparare il PDF'},503);}
}
