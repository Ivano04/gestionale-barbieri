import { createAdminClient } from '@/lib/supabase/admin';
import { GHLClient } from './client';

// Previene poll concorrenti
const polling = new Set<string>();

export async function pollGHL(salonId: string) {
  const apiKey = process.env.GHL_AGENCY_API_KEY;
  if (!apiKey) return;

  if (polling.has(salonId)) return;
  polling.add(salonId);

  const supabase = createAdminClient();
  try {
    // Recupera configurazione salone
    const { data: salon } = await supabase
      .from('salons')
      .select('ghl_subaccount_id')
      .eq('id', salonId)
      .single();
    if (!salon?.ghl_subaccount_id) return;

    // Recupera tutti gli stylist con ghl_calendar_id
    const { data: stylists } = await supabase
      .from('users')
      .select('id, full_name, ghl_calendar_id')
      .eq('salon_id', salonId)
      .eq('role', 'stylist')
      .eq('is_active', true);

    const ghl = new GHLClient(apiKey);
    const defaultCalendarId = process.env.GHL_CALENDAR_ID || '';
    const calendarId = defaultCalendarId || (stylists?.[0]?.ghl_calendar_id);

    if (!calendarId) return;

    // Ultimo sync per questo salone
    const { data: lastLog } = await supabase
      .from('sync_log')
      .select('created_at')
      .eq('salon_id', salonId)
      .eq('direction', 'ghl→us')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1);

    const updatedSince = lastLog?.length
      ? new Date(lastLog[0].created_at).toISOString()
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30); // prossimi 30 giorni

    const ghlAppts = await ghl.getAppointments({
      subaccountId: salon.ghl_subaccount_id,
      calendarId,
      startTime: updatedSince,
      endTime: endDate.toISOString(),
    });

    for (const ga of ghlAppts) {
      const ghlId = String(ga.id);

      // Salta se già importato
      const { data: existing } = await supabase
        .from('appointments')
        .select('id, status')
        .eq('ghl_appointment_id', ghlId)
        .limit(1);

      // Cancellato su GHL
      if (ga.appointmentStatus === 'cancelled' || ga.isDeleted) {
        if (existing?.length && existing[0].status !== 'cancelled') {
          await supabase
            .from('appointments')
            .update({ status: 'cancelled' })
            .eq('id', existing[0].id);
          await supabase.from('sync_log').insert({
            salon_id: salonId,
            direction: 'ghl→us',
            status: 'success',
            external_id: ghlId,
          });
        }
        continue;
      }

      if (existing?.length) continue; // già importato e non cancellato

      // Risolvi cliente
      let clientId: string | null = null;
      if (ga.contactId) {
        const contact = await ghl.getContact(ga.contactId);
        if (contact) {
          const phone = contact.phone || '';
          const firstName = contact.firstName || '';
          const lastName = contact.lastName || '';
          const email = contact.email || '';

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
              const { data: nc } = await supabase
                .from('clients')
                .insert({ salon_id: salonId, first_name: firstName, last_name: lastName, phone, email, ghl_contact_id: ga.contactId })
                .select('id').single();
              if (nc) clientId = nc.id;
            }
          } else if (firstName || lastName) {
            const { data: nc } = await supabase
              .from('clients')
              .insert({ salon_id: salonId, first_name: firstName || 'Cliente', last_name: lastName || '', phone: null, email, ghl_contact_id: ga.contactId })
              .select('id').single();
            if (nc) clientId = nc.id;
          }
        }
      }

      // Risolvi stylist (mappa ghl_calendar_id → stylist)
      let stylistId: string | null = null;
      if (ga.calendarId && stylists?.length) {
        const st = stylists.find(s => s.ghl_calendar_id === ga.calendarId);
        if (st) stylistId = st.id;
      }

      // Inserisci appuntamento
      await supabase.from('appointments').insert({
        salon_id: salonId,
        client_id: clientId,
        stylist_id: stylistId,
        start_time: ga.startTime,
        end_time: ga.endTime,
        status: 'confirmed',
        source: 'google',
        ghl_appointment_id: ghlId,
        notes: ga.title || null,
      });

      await supabase.from('sync_log').insert({
        salon_id: salonId,
        direction: 'ghl→us',
        status: 'success',
        external_id: ghlId,
      });
    }
  } catch (e: any) {
    console.error('[ghl-poll] error:', e.message);
  } finally {
    polling.delete(salonId);
  }
}
