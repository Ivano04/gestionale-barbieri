import { createAdminClient } from '@/lib/supabase/admin';
import { GHLClient } from './client';
import type { Appointment, Client } from '@/lib/types';

export async function pushToGHL(
  appointment: Appointment,
  client: Client | null,
) {
  const supabase = createAdminClient();
  const { data: salon } = await supabase
    .from('salons')
    .select('ghl_subaccount_id')
    .eq('id', appointment.salon_id)
    .single();
  console.error('[ghl-debug] pushToGHL: salon found:', !!salon, 'subaccount:', salon?.ghl_subaccount_id);
  if (!salon?.ghl_subaccount_id) { console.error('[ghl-debug] pushToGHL: NO subaccount, returning'); return; }

  const ghl = new GHLClient(process.env.GHL_AGENCY_API_KEY!);

  try {
    let ghlContactId = client?.ghl_contact_id;
    console.error('[ghl-debug] pushToGHL: existing ghlContactId:', ghlContactId, 'client phone:', client?.phone);
    if (!ghlContactId && client) {
      console.error('[ghl-debug] pushToGHL: calling findOrCreateContact...');
      ghlContactId = await ghl.findOrCreateContact(
        salon.ghl_subaccount_id,
        {
          firstName: client.first_name,
          lastName: client.last_name,
          phone: client.phone || '',
          email: client.email || '',
        },
      );
      console.error('[ghl-debug] pushToGHL: got ghlContactId:', ghlContactId);
      await supabase
        .from('clients')
        .update({ ghl_contact_id: ghlContactId })
        .eq('id', client.id);
    }

    console.error('[ghl-debug] pushToGHL: ghlContactId before appt create:', ghlContactId);
    if (ghlContactId) {
      const ghlApptId = await ghl.createAppointment(
        salon.ghl_subaccount_id,
        {
          contactId: ghlContactId,
          title: appointment.service?.name || 'Appuntamento',
          startTime: appointment.start_time,
          endTime: appointment.end_time,
          calendarId: process.env.GHL_CALENDAR_ID || 'zj2Uo3Bd29fSt1xJi3oF',
        },
      );
      await supabase
        .from('appointments')
        .update({ ghl_appointment_id: ghlApptId })
        .eq('id', appointment.id);
      await supabase.from('sync_log').insert({
        salon_id: appointment.salon_id,
        direction: 'us->ghl',
        appointment_id: appointment.id,
        status: 'success',
        external_id: ghlApptId,
      });
    }
  } catch (e: any) {
    await supabase.from('sync_log').insert({
      salon_id: appointment.salon_id,
      direction: 'us->ghl',
      appointment_id: appointment.id,
      status: 'failed',
      error_message: e.message,
    });
  }
}
