import { fiscalStaffAccess } from '@/services/fiscal/staff-access';
import { BOOKING_UUID } from '@/lib/booking-services';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await fiscalStaffAccess();
  if (access.response) return access.response;
  const { id } = await params;
  if (!BOOKING_UUID.test(id)) return json({ error: 'Cliente non valido' }, 400);
  const { data: client, error: clientError } = await access.db.from('clients').select('id').eq('id', id).eq('salon_id', access.salonId).maybeSingle();
  if (clientError) return json({ error: 'Storico non disponibile' }, 503);
  if (!client) return json({ error: 'Cliente non disponibile' }, 404);
  const { data, error } = await access.db.from('daily_notifications')
    .select('id,visit_date,type,state,due_at,sent_at,last_error_code')
    .eq('salon_id', access.salonId).eq('client_id', id).order('visit_date', { ascending: false }).order('type').limit(100);
  if (error) return json({ error: 'Storico non disponibile' }, 503);
  return json({ notifications: data ?? [], hasMore: data?.length === 100 });
}
