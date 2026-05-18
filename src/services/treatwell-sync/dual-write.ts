import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';

interface DualWriteRequest {
  salon_id: string;
  service_name: string;
  treatwell_service_id: string | null;
  start_time: string;
  end_time: string;
  appointment_id: string;
}

export async function checkAndWriteTreatwell(
  req: DualWriteRequest,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { data: salon } = await supabase
    .from('salons')
    .select('treatwell_salon_id, treatwell_api_enabled')
    .eq('id', req.salon_id)
    .single();

  if (!salon?.treatwell_api_enabled || !salon?.treatwell_salon_id) return true;

  const client = new TreatwellClient({
    baseUrl: process.env.TREATWELL_API_BASE_URL!,
    salonId: salon.treatwell_salon_id,
  });

  try {
    const isFree = await client.checkSlot(
      req.start_time,
      req.end_time,
      req.treatwell_service_id || '',
    );
    if (!isFree) {
      await supabase.from('sync_log').insert({
        salon_id: req.salon_id,
        direction: 'us->treatwell',
        appointment_id: req.appointment_id,
        status: 'conflict',
        error_message: 'Slot non disponibile su Treatwell',
      });
      return false;
    }

    const twId = await client.createAppointment({
      start: req.start_time,
      end: req.end_time,
      serviceId: req.treatwell_service_id || '',
      clientName: '',
      clientPhone: '',
    });

    if (twId) {
      await supabase
        .from('appointments')
        .update({ treatwell_appointment_id: twId })
        .eq('id', req.appointment_id);
      await supabase.from('sync_log').insert({
        salon_id: req.salon_id,
        direction: 'us->treatwell',
        appointment_id: req.appointment_id,
        status: 'success',
        external_id: twId,
      });
      return true;
    }
  } catch (e: any) {
    await supabase.from('sync_log').insert({
      salon_id: req.salon_id,
      direction: 'us->treatwell',
      appointment_id: req.appointment_id,
      status: 'pending_retry',
      error_message: e.message,
      retry_count: 0,
    });
    return false;
  }

  return false;
}
