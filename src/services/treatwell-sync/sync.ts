import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';
import type { Appointment, Client } from '@/lib/types';

function getClient(): TreatwellClient {
  return new TreatwellClient({
    baseUrl: process.env.TREATWELL_API_BASE_URL || 'https://api.uala.it/api/v1',
    venueId: process.env.TREATWELL_VENUE_ID || '482',
    token: process.env.TREATWELL_API_TOKEN || '',
    clientAuth: process.env.TREATWELL_CLIENT_AUTH || '',
  });
}

/** Convert UTC ISO time to Italy local time for Uala */
function toItalyTime(utcIso: string): string {
  return new Date(utcIso)
    .toLocaleString('sv-SE', { timeZone: 'Europe/Rome' })
    .replace(' ', 'T');
}

export async function pushToTreatwell(
  appointment: Appointment,
  client: Client | null,
) {
  if (!process.env.TREATWELL_API_TOKEN) return;

  const supabase = createAdminClient();
  const { data: salon } = await supabase
    .from('salons')
    .select('treatwell_api_enabled')
    .eq('id', appointment.salon_id)
    .single();
  if (!salon?.treatwell_api_enabled) return;

  const tw = getClient();

  try {
    // Find or create customer
    const clientName = client
      ? `${client.first_name} ${client.last_name}`
      : 'Cliente';
    const clientPhone = client?.phone || '';
    const customerId = await tw.findOrCreateCustomer(clientName, clientPhone);
    if (client && !client.treatwell_client_id) {
      await supabase
        .from('clients')
        .update({ treatwell_client_id: String(customerId) })
        .eq('id', client.id);
    }

    // Get staff member ID
    const stylist = appointment.stylist as any;
    const ualaStaffId = stylist?.uala_staff_id;
    if (!ualaStaffId) {
      await supabase.from('sync_log').insert({
        salon_id: appointment.salon_id,
        direction: 'us→treatwell',
        appointment_id: appointment.id,
        status: 'failed',
        error_message: 'Stylist senza uala_staff_id',
      });
      return;
    }

    // Get treatment ID
    const service = appointment.service as any;
    const ualaTreatmentId = service?.uala_treatment_id;
    if (!ualaTreatmentId) {
      await supabase.from('sync_log').insert({
        salon_id: appointment.salon_id,
        direction: 'us→treatwell',
        appointment_id: appointment.id,
        status: 'failed',
        error_message: 'Servizio senza uala_treatment_id',
      });
      return;
    }

    // Find the staff_member_treatment_id
    const staffTreatments = await tw.getStaffMemberTreatments();
    const match = staffTreatments.find(
      (st: any) =>
        st.staff_member_id === ualaStaffId &&
        st.venue_treatment_id === ualaTreatmentId,
    );
    if (!match) {
      await supabase.from('sync_log').insert({
        salon_id: appointment.salon_id,
        direction: 'us→treatwell',
        appointment_id: appointment.id,
        status: 'failed',
        error_message: `Nessuna combinazione staff=${ualaStaffId} + treatment=${ualaTreatmentId}`,
      });
      return;
    }

    const localTime = toItalyTime(appointment.start_time);
    const twApptId = await tw.createAppointment({
      staffMemberId: ualaStaffId,
      staffMemberTreatmentId: match.id,
      time: localTime,
      customerId,
      notes: appointment.notes || undefined,
    });

    await supabase
      .from('appointments')
      .update({ treatwell_appointment_id: String(twApptId) })
      .eq('id', appointment.id);

    await supabase.from('sync_log').insert({
      salon_id: appointment.salon_id,
      direction: 'us→treatwell',
      appointment_id: appointment.id,
      status: 'success',
      external_id: String(twApptId),
    });
  } catch (e: any) {
    await supabase.from('sync_log').insert({
      salon_id: appointment.salon_id,
      direction: 'us→treatwell',
      appointment_id: appointment.id,
      status: 'failed',
      error_message: e.message,
    });
  }
}

export async function deleteFromTreatwell(
  treatwellAppointmentId: string,
  salonId: string,
  appointmentId: string,
) {
  if (!process.env.TREATWELL_API_TOKEN) return;

  const supabase = createAdminClient();
  const { data: salon } = await supabase
    .from('salons')
    .select('treatwell_api_enabled')
    .eq('id', salonId)
    .single();
  if (!salon?.treatwell_api_enabled) return;

  const tw = getClient();

  try {
    await tw.cancelAppointment(Number(treatwellAppointmentId));
    await supabase.from('sync_log').insert({
      salon_id: salonId,
      direction: 'us→treatwell',
      appointment_id: appointmentId,
      status: 'success',
      external_id: treatwellAppointmentId,
    });
  } catch (e: any) {
    await supabase.from('sync_log').insert({
      salon_id: salonId,
      direction: 'us→treatwell',
      appointment_id: appointmentId,
      status: 'failed',
      error_message: e.message,
    });
  }
}
