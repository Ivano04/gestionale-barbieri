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

export async function pushToTreatwell(
  appointment: Appointment,
  client: Client | null,
) {
  console.error('[tw] pushToTreatwell START');
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
    console.error('[tw] finding customer...');
    const customerId = await tw.findOrCreateCustomer(clientName, clientPhone);
    console.error('[tw] customerId:', customerId);
    if (client && !client.treatwell_client_id) {
      await supabase
        .from('clients')
        .update({ treatwell_client_id: String(customerId) })
        .eq('id', client.id);
    }

    // Get staff member ID from Uala
    const stylist = appointment.stylist as any;
    const ualaStaffId = stylist?.uala_staff_id;
    if (!ualaStaffId) {
      await supabase.from('sync_log').insert({
        salon_id: appointment.salon_id,
        direction: 'us->treatwell',
        appointment_id: appointment.id,
        status: 'failed',
        error_message: 'Stylist senza uala_staff_id',
      });
      return;
    }

    // Get treatment ID from Uala
    const service = appointment.service as any;
    const ualaTreatmentId = service?.uala_treatment_id;
    console.error('[tw] staffId:', ualaStaffId, 'treatmentId:', ualaTreatmentId);
    if (!ualaTreatmentId) {
      await supabase.from('sync_log').insert({
        salon_id: appointment.salon_id,
        direction: 'us->treatwell',
        appointment_id: appointment.id,
        status: 'failed',
        error_message: 'Servizio senza uala_treatment_id',
      });
      return;
    }

    // Find the staff_member_treatment_id for this combination
    const treatmentsRes = await fetch(
      `${process.env.TREATWELL_API_BASE_URL || 'https://api.uala.it/api/v1'}/venues/${process.env.TREATWELL_VENUE_ID || '482'}/staff_member_treatments`,
      {
        headers: {
          Authorization: `Bearer ${process.env.TREATWELL_API_TOKEN}`,
          'X-Client-Auth': process.env.TREATWELL_CLIENT_AUTH || '',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!treatmentsRes.ok) {
      throw new Error(`Failed to fetch staff treatments: ${treatmentsRes.status}`);
    }
    const treatmentsData = await treatmentsRes.json();
    const staffTreatments = treatmentsData?.data?.staff_member_treatments || [];
    const match = staffTreatments.find(
      (st: any) =>
        st.staff_member_id === ualaStaffId &&
        st.venue_treatment_id === ualaTreatmentId,
    );
    if (!match) {
      await supabase.from('sync_log').insert({
        salon_id: appointment.salon_id,
        direction: 'us->treatwell',
        appointment_id: appointment.id,
        status: 'failed',
        error_message: `Nessuna combinazione staff=${ualaStaffId} + treatment=${ualaTreatmentId}`,
      });
      return;
    }

    const twApptId = await tw.createAppointment({
      staffMemberId: ualaStaffId,
      staffMemberTreatmentId: match.id,
      time: appointment.start_time,
      customerId,
      notes: appointment.notes || undefined,
    });

    await supabase
      .from('appointments')
      .update({ treatwell_appointment_id: String(twApptId) })
      .eq('id', appointment.id);

    await supabase.from('sync_log').insert({
      salon_id: appointment.salon_id,
      direction: 'us->treatwell',
      appointment_id: appointment.id,
      status: 'success',
      external_id: String(twApptId),
    });
  } catch (e: any) {
    await supabase.from('sync_log').insert({
      salon_id: appointment.salon_id,
      direction: 'us->treatwell',
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
    await tw.deleteAppointment(Number(treatwellAppointmentId));
    await supabase.from('sync_log').insert({
      salon_id: salonId,
      direction: 'us->treatwell',
      appointment_id: appointmentId,
      status: 'success',
      external_id: treatwellAppointmentId,
    });
  } catch (e: any) {
    await supabase.from('sync_log').insert({
      salon_id: salonId,
      direction: 'us->treatwell',
      appointment_id: appointmentId,
      status: 'failed',
      error_message: e.message,
    });
  }
}
