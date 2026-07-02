import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';

interface UalaAppointment {
  id: number;
  staff_member_id: number;
  customer_id: number | null;
  customer_full_name: string | null;
  customer_phone_number: string | null;
  time: string;
  state: string;
  data?: any;
}

export async function pollTreatwell(salonId: string, twClient: TreatwellClient) {
  const supabase = createAdminClient();
  const today = new Date().toISOString().split('T')[0];

  try {
    const twAppointments: UalaAppointment[] = await twClient.getAppointments(today);
    if (!twAppointments?.length) return;

    for (const tw of twAppointments) {
      if (tw.state === 'deleted' || tw.state === 'cancelled') continue;

      // Check if already imported
      const { data: existing } = await supabase
        .from('appointments')
        .select('id')
        .eq('treatwell_appointment_id', String(tw.id))
        .limit(1);
      if (existing?.length) continue;

      // Resolve client
      let clientId: string | null = null;
      if (tw.customer_phone_number) {
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('salon_id', salonId)
          .eq('phone', tw.customer_phone_number)
          .limit(1);
        if (client?.length) {
          clientId = client[0].id;
        } else {
          const name = tw.customer_full_name || 'Cliente';
          const [firstName, ...lastParts] = name.trim().split(' ');
          const lastName = lastParts.join(' ') || '';
          const { data: newClient } = await supabase
            .from('clients')
            .insert({
              salon_id: salonId,
              first_name: firstName,
              last_name: lastName,
              phone: tw.customer_phone_number,
              treatwell_client_id: String(tw.customer_id || ''),
            })
            .select('id')
            .single();
          if (newClient) clientId = newClient.id;
        }
      }

      // Resolve stylist
      const { data: stylist } = await supabase
        .from('users')
        .select('id')
        .eq('uala_staff_id', tw.staff_member_id)
        .eq('salon_id', salonId)
        .limit(1);

      // Resolve service from the appointment data
      let serviceId: string | null = null;
      if (tw.data?.staff_member_treatment?.venue_treatment_id) {
        const { data: service } = await supabase
          .from('services')
          .select('id')
          .eq('uala_treatment_id', tw.data.staff_member_treatment.venue_treatment_id)
          .eq('salon_id', salonId)
          .limit(1);
        if (service?.length) serviceId = service[0].id;
      }

      // End time from duration
      const duration = tw.data?.staff_member_treatment?.total_duration || 1800;
      const startTime = tw.time;
      const endTime = new Date(
        new Date(startTime).getTime() + duration * 1000,
      ).toISOString();

      // Conflict check
      const { data: conflict } = await supabase
        .from('appointments')
        .select('id')
        .eq('salon_id', salonId)
        .lt('start_time', endTime)
        .gt('end_time', startTime)
        .neq('status', 'cancelled')
        .limit(1);

      if (conflict?.length) {
        await supabase.from('sync_log').insert({
          salon_id: salonId,
          direction: 'treatwell->us',
          status: 'conflict',
          external_id: String(tw.id),
          error_message: `Slot occupato da ${conflict[0].id}`,
        });
        continue;
      }

      await supabase.from('appointments').insert({
        salon_id: salonId,
        client_id: clientId,
        stylist_id: stylist?.[0]?.id,
        service_id: serviceId,
        start_time: startTime,
        end_time: endTime,
        status: 'confirmed',
        source: 'treatwell',
        treatwell_appointment_id: String(tw.id),
      });

      await supabase.from('sync_log').insert({
        salon_id: salonId,
        direction: 'treatwell->us',
        status: 'success',
        external_id: String(tw.id),
      });
    }
  } catch (e: any) {
    console.error('Poll error for salon', salonId, e);
  }
}
