import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';

type DeltaCategory = 'new' | 'updated' | 'canceled';

// Previene poll concorrenti che causano duplicati
const polling = new Set<string>();

/** Classifica un delta come fa il Python: new / updated / canceled.
 *  Case-insensitive e tollerante su varianti (canceled/cancelled/deleted). */
function classifyDelta(appt: any): DeltaCategory {
  const rawState = (appt.state || '').toLowerCase().trim();
  // Qualsiasi variante di cancellazione/eliminazione/sostituzione
  // Uala usa: canceled, cancelled, deleted, discarded
  if (rawState.startsWith('cancel') || rawState === 'deleted' || rawState === 'discarded') return 'canceled';
  const created = appt.created_at || '';
  const updated = appt.updated_at || '';
  // Se created_at == updated_at, è la prima volta che vediamo questo record
  if (created && updated && created === updated) return 'new';
  // Se created_at != updated_at, è stato modificato dopo la creazione
  if (created && updated && created !== updated) return 'updated';
  // Fallback: se non abbiamo i timestamp, assumiamo "new"
  return 'new';
}

export async function pollTreatwell(salonId: string, twClient: TreatwellClient) {
  // Anti-concorrenza: se un poll è già in corso per questo salone, esci
  if (polling.has(salonId)) return;
  polling.add(salonId);

  const supabase = createAdminClient();

  try {
    // Get last sync timestamp for this salon
    const { data: lastLog } = await supabase
      .from('sync_log')
      .select('created_at')
      .eq('salon_id', salonId)
      .eq('direction', 'treatwell→us')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1);

    const updatedSince = lastLog?.length
      ? new Date(lastLog[0].created_at).toISOString()
      : new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const data = await twClient.getSync(updatedSince);
    const appointments: any[] = data?.data?.appointments || [];

    for (const tw of appointments) {
      const twId = String(tw.id);
      const category = classifyDelta(tw);

      // ── CANCELLED ──
      if (category === 'canceled') {
        const { data: existing } = await supabase
          .from('appointments')
          .select('id')
          .eq('treatwell_appointment_id', twId)
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
          external_id: twId,
        });
        continue;
      }

      // ── Resolve client ──
      // Prova per telefono, poi per treatwell_client_id, infine crea con solo nome
      let clientId: string | null = null;
      const phone = tw.customer_phone_number || '';
      const name = (tw.customer_full_name || '').trim();
      const twCustomerId = tw.customer_id ? String(tw.customer_id) : '';

      if (phone) {
        // Cerca per telefono
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('salon_id', salonId)
          .eq('phone', phone)
          .limit(1);
        if (client?.length) {
          clientId = client[0].id;
        } else {
          const [firstName, ...lastParts] = name.split(' ');
          const { data: newClient } = await supabase
            .from('clients')
            .insert({
              salon_id: salonId,
              first_name: firstName || 'Cliente',
              last_name: lastParts.join(' ') || '',
              phone,
              treatwell_client_id: twCustomerId,
            })
            .select('id')
            .single();
          if (newClient) clientId = newClient.id;
        }
      } else if (twCustomerId) {
        // Cerca per treatwell_client_id (clienti marketplace senza telefono)
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('salon_id', salonId)
          .eq('treatwell_client_id', twCustomerId)
          .limit(1);
        if (client?.length) {
          clientId = client[0].id;
        }
      }

      // Se ancora nessun client e abbiamo un nome, crealo senza telefono
      if (!clientId && name && name !== 'Cliente') {
        const [firstName, ...lastParts] = name.split(' ');
        const { data: newClient } = await supabase
          .from('clients')
          .insert({
            salon_id: salonId,
            first_name: firstName || name,
            last_name: lastParts.join(' ') || '',
            phone: null,
            treatwell_client_id: twCustomerId,
          })
          .select('id')
          .single();
        if (newClient) clientId = newClient.id;
      }

      // ── Resolve stylist ──
      const { data: stylist } = await supabase
        .from('users')
        .select('id')
        .eq('uala_staff_id', tw.staff_member_id)
        .eq('salon_id', salonId)
        .limit(1);

      // ── Resolve service ──
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

      // ── End time from duration ──
      const duration = tw.data?.staff_member_treatment?.total_duration || 1800;
      const startTime = tw.time;
      const endTime = new Date(
        new Date(startTime).getTime() + duration * 1000,
      ).toISOString();

      // ── UPDATED: modifica appuntamento esistente ──
      if (category === 'updated') {
        const { data: existing } = await supabase
          .from('appointments')
          .select('id, start_time, end_time, stylist_id, service_id, client_id')
          .eq('treatwell_appointment_id', twId)
          .eq('salon_id', salonId)
          .limit(1);

        if (existing?.length) {
          const current = existing[0];

          // Conflict check (skip self-conflict)
          const { data: conflict } = await supabase
            .from('appointments')
            .select('id')
            .eq('salon_id', salonId)
            .lt('start_time', endTime)
            .gt('end_time', startTime)
            .neq('status', 'cancelled')
            .neq('id', current.id)
            .limit(1);

          if (conflict?.length) {
            await supabase.from('sync_log').insert({
              salon_id: salonId,
              direction: 'treatwell→us',
              status: 'conflict',
              external_id: twId,
              error_message: `Conflitto con appuntamento ${conflict[0].id} durante aggiornamento`,
            });
            continue;
          }

          await supabase
            .from('appointments')
            .update({
              start_time: startTime,
              end_time: endTime,
              stylist_id: stylist?.[0]?.id || current.stylist_id,
              service_id: serviceId || current.service_id,
              client_id: clientId || current.client_id,
            })
            .eq('id', current.id);

          await supabase.from('sync_log').insert({
            salon_id: salonId,
            direction: 'treatwell→us',
            status: 'success',
            external_id: twId,
          });
          continue;
        }
        // Fall through to NEW if not found
      }

      // ── NEW: crea nuovo appuntamento ──
      // Usa upsert su treatwell_appointment_id per prevenire duplicati
      const { data: alreadyExists } = await supabase
        .from('appointments')
        .select('id')
        .eq('treatwell_appointment_id', twId)
        .limit(1);
      if (alreadyExists?.length) continue;

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
          external_id: twId,
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
        treatwell_appointment_id: twId,
      });

      await supabase.from('sync_log').insert({
        salon_id: salonId,
        direction: 'treatwell→us',
        status: 'success',
        external_id: twId,
      });
    }
  } catch (e: any) {
    console.error('Poll error for salon', salonId, e);
  } finally {
    polling.delete(salonId);
  }
}
