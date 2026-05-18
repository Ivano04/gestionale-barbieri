import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';

export async function pollTreatwell(salonId: string, twClient: TreatwellClient) {
  const supabase = createAdminClient();
  const today = new Date().toISOString().split('T')[0];

  try {
    const twAppointments = await twClient.getAppointments(today);
    if (!twAppointments?.length) return;

    for (const tw of twAppointments) {
      const { data: existing } = await supabase
        .from('appointments')
        .select('id')
        .eq('treatwell_appointment_id', tw.id)
        .limit(1);
      if (existing?.length) continue;

      let clientId: string | null = null;
      if (tw.clientPhone) {
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('salon_id', salonId)
          .eq('phone', tw.clientPhone)
          .limit(1);
        if (client?.length) {
          clientId = client[0].id;
        } else {
          const { data: newClient } = await supabase
            .from('clients')
            .insert({
              salon_id: salonId,
              first_name: tw.clientName?.split(' ')[0] || '',
              last_name:
                tw.clientName?.split(' ').slice(1).join(' ') || '',
              phone: tw.clientPhone,
              treatwell_client_id: tw.clientId,
            })
            .select('id')
            .single();
          if (newClient) clientId = newClient.id;
        }
      }

      const { data: service } = await supabase
        .from('services')
        .select('id')
        .eq('treatwell_service_id', tw.serviceId)
        .eq('salon_id', salonId)
        .limit(1);

      const { data: conflict } = await supabase
        .from('appointments')
        .select('id')
        .eq('salon_id', salonId)
        .lt('start_time', tw.end)
        .gt('end_time', tw.start)
        .neq('status', 'cancelled')
        .limit(1);

      if (conflict?.length) {
        await supabase.from('sync_log').insert({
          salon_id: salonId,
          direction: 'treatwell->us',
          status: 'conflict',
          external_id: tw.id,
          error_message: `Slot occupato da ${conflict[0].id}`,
        });
        continue;
      }

      await supabase.from('appointments').insert({
        salon_id: salonId,
        client_id: clientId,
        service_id: service?.[0]?.id,
        start_time: tw.start,
        end_time: tw.end,
        status: 'confirmed',
        source: 'treatwell',
        treatwell_appointment_id: tw.id,
      });

      await supabase.from('sync_log').insert({
        salon_id: salonId,
        direction: 'treatwell->us',
        status: 'success',
        external_id: tw.id,
      });
    }
  } catch (e: any) {
    console.error('Poll error for salon', salonId, e);
  }
}
