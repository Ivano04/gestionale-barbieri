import { createAdminClient } from '@/lib/supabase/admin';
import { snapshotServices } from '@/lib/booking-services';
export async function fetchBookingServices(salonId: string, ids: string[]) {
  const { data, error } = await createAdminClient().from('services')
    .select('id,name,price_cents,duration_minutes,duration_application,duration_processing,duration_finishing,buffer_time_minutes')
    .eq('salon_id', salonId).eq('is_active', true).in('id', ids);
  if (error) throw new Error('Impossibile leggere i servizi');
  return snapshotServices(ids, data ?? []);
}
