import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';

export async function pollTreatwell(salonId: string, twClient: TreatwellClient) {
  const supabase = createAdminClient();

  // Get last sync timestamp for this salon
  const { data: lastLog } = await supabase
    .from('sync_log')
    .select('created_at')
    .eq('direction', 'treatwell→us')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1);

  const updatedSince = lastLog?.length
    ? new Date(lastLog[0].created_at).toISOString().replace('.000Z', '.000Z')
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('.000Z', '.000Z');

  try {
    const data = await twClient.getSync(updatedSince);
    const appointments = data?.data?.appointments || [];

    for (const tw of appointments) {
      // Skip deleted/cancelled — handled separately
      if (tw.state === 'deleted' || tw.state === 'canceled') continue;
      // Skip if already imported
      const { data: existing } = await supabase
        .from('appointments')
        .select('id')
        .eq('treatwell_appointment_id', String(tw.id))
        .limit(1);
      if (existing?.length) continue;

      // Resolve client
      let clientId: string | null = null;
      const phone = tw.customer_phone_number || '';
      const name = tw.customer_full_name || 'Cliente';
      if (phone) {
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('salon_id', salonId)
          .eq('phone', phone)
          .limit(1);
        if (client?.length) {
          clientId = client[0].id;
        } else {
          const [firstName, ...lastParts] = name.trim().split(' ');
          const { data: newClient } = await supabase
            .from('clients')
            .insert({
              salon_id: salonId,
              first_name: firstName || 'Cliente',
              last_name: lastParts.join(' ') || '',
              phone,
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

      // Resolve service
      const venueTreatmentId = tw.data?.staff_member_treatment?.venue_treatment_id;
      let serviceId: string | null = null;
      if (venueTreatmentId) {
        const { data: service } = await supabase
          .from('services')
          .select('id')
          .eq('uala_treatment_id', venueTreatmentId)
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
          direction: 'treatwell→us',
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
        direction: 'treatwell→us',
        status: 'success',
        external_id: String(tw.id),
      });
    }

    // Handle cancellations
    for (const tw of appointments) {
      if (tw.state !== 'deleted' && tw.state !== 'canceled') continue;
      const { data: existing } = await supabase
        .from('appointments')
        .select('id')
        .eq('treatwell_appointment_id', String(tw.id))
        .limit(1);
      if (!existing?.length) continue;

      await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', existing[0].id);

      await supabase.from('sync_log').insert({
        salon_id: salonId,
        direction: 'treatwell→us',
        status: 'success',
        external_id: String(tw.id),
      });
    }
  } catch (e: any) {
    console.error('Poll error for salon', salonId, e);
  }
}
