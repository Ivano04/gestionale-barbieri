import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';

// Previene poll concorrenti che causano duplicati
const polling = new Set<string>();
// Throttle full load: max 1 ogni 30 minuti
const lastFullLoad = new Map<string, number>();
/** Watermark per salone, ancorato all'istante di LETTURA da Uala.
 *  In memoria: al riavvio si riparte dall'ultimo sync_log riuscito. */
const lastSyncAt = new Map<string, number>();
/** Sovrapposizione di sicurezza della finestra di sync (clock skew, poll persi). */
const SYNC_OVERLAP_MS = 2 * 60 * 1000;

/** Sincronizza l'email da Uala al nostro cliente, se mancante */
async function syncClientEmail(
  supabase: ReturnType<typeof createAdminClient>,
  twClient: TreatwellClient,
  clientId: string,
  twCustomerId: string,
) {
  if (!twCustomerId) return;
  const { data: client } = await supabase.from('clients').select('email').eq('id', clientId).single();
  if (client?.email) return; // già ha l'email

  const twCust = await twClient.getCustomer(Number(twCustomerId));
  if (twCust?.email) {
    await supabase.from('clients').update({ email: twCust.email }).eq('id', clientId);
  }
}

/** Normalizza un numero di telefono per confronti consistenti.
 *  Strip spazi/trattini, converte prefissi italiani (0... → +39...). */
function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-\(\)\.]/g, '');
  // Converti numeri italiani senza prefisso internazionale
  if (/^0\d{6,10}$/.test(p)) p = '+39' + p.substring(1);
  // Assicura + davanti
  if (!p.startsWith('+') && /^\d+$/.test(p)) p = '+' + p;
  return p;
}

/** True se lo stato Uala indica una cancellazione/eliminazione.
 *  Uala usa: canceled, cancelled, deleted, discarded. */
function isCancelledState(state: unknown): boolean {
  const s = String(state || '').toLowerCase().trim();
  return s.startsWith('cancel') || s === 'deleted' || s === 'discarded';
}

/** Estrae la durata (in secondi) da un appuntamento Uala.
 *  Forma del payload verificata sull'API reale:
 *    custom_duration        → top-level, number oppure null (durata modificata a mano su Treatwell)
 *    data.staff_member_treatment.duration / .total_duration → durata standard del trattamento
 *  custom_duration ha la precedenza quando valorizzato. */
function extractDuration(tw: any): number {
  const candidates = [
    tw?.custom_duration,
    tw?.data?.staff_member_treatment?.duration,
    tw?.data?.staff_member_treatment?.total_duration,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1800; // fallback 30 min
}

/** Log diagnostico TEMPORANEO: stampa la forma del payload Uala per capire
 *  dove risiedono davvero custom_duration e i timestamp. Rimuovere dopo la diagnosi. */
function logPayloadShape(tw: any, context: string) {
  if (process.env.TREATWELL_DEBUG !== '1') return;
  console.log(`[tw-debug:${context}] id=${tw?.id}`, JSON.stringify({
    state: tw?.state,
    time: tw?.time,
    created_at: tw?.created_at,
    updated_at: tw?.updated_at,
    custom_duration: tw?.custom_duration,
    duration: tw?.duration,
    data_keys: tw?.data ? Object.keys(tw.data) : null,
    data_custom_duration: tw?.data?.custom_duration,
    data_duration: tw?.data?.duration,
    smt: tw?.data?.staff_member_treatment
      ? {
          duration: tw.data.staff_member_treatment.duration,
          total_duration: tw.data.staff_member_treatment.total_duration,
        }
      : null,
    resolved_duration: extractDuration(tw),
  }));
}

/** Riga che l'appuntamento DOVREBBE avere secondo Uala.
 *  Preserva il buffer (delta fra buffer_end_time ed end_time) impostato da noi. */
function buildDesiredRow(
  tw: any,
  current: any,
  startTime: string,
  endTime: string,
  stylistId: string | undefined,
  serviceId: string | null,
  clientId: string | null,
) {
  const prevBufferMs = current.buffer_end_time
    ? new Date(current.buffer_end_time).getTime() - new Date(current.end_time).getTime()
    : 0;
  const bufferEndTime = prevBufferMs > 0
    ? new Date(new Date(endTime).getTime() + prevBufferMs).toISOString()
    : endTime;

  return {
    start_time: startTime,
    end_time: endTime,
    buffer_end_time: bufferEndTime,
    stylist_id: stylistId || current.stylist_id,
    service_id: serviceId || current.service_id,
    client_id: clientId || current.client_id,
    // Un appuntamento tornato non-cancellato su Uala torna confermato
    status: 'confirmed' as const,
  };
}

/** Confronta due istanti tollerando formati diversi (+02:00 vs Z). */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** True se la riga desiderata differisce da quella a DB. */
function hasChanges(current: any, desired: ReturnType<typeof buildDesiredRow>): boolean {
  return (
    !sameInstant(desired.start_time, current.start_time) ||
    !sameInstant(desired.end_time, current.end_time) ||
    !sameInstant(desired.buffer_end_time, current.buffer_end_time) ||
    desired.stylist_id !== current.stylist_id ||
    desired.service_id !== current.service_id ||
    desired.client_id !== current.client_id ||
    desired.status !== current.status
  );
}

export async function pollTreatwell(salonId: string, twClient: TreatwellClient) {
  // Anti-concorrenza: se un poll è già in corso per questo salone, esci
  if (polling.has(salonId)) return;
  polling.add(salonId);

  const supabase = createAdminClient();

  try {
    // Il watermark va ancorato all'istante in cui LEGGIAMO da Uala, non a quello in cui
    // scriviamo: il poller impiega secondi a elaborare, e una modifica fatta su Treatwell
    // nel frattempo verrebbe altrimenti scavalcata dal watermark e persa per sempre.
    const readAt = Date.now();

    let watermark = lastSyncAt.get(salonId);
    if (watermark === undefined) {
      // Cold start (riavvio del processo): riparti dall'ultimo sync riuscito a DB
      const { data: lastLog } = await supabase
        .from('sync_log')
        .select('created_at')
        .eq('salon_id', salonId)
        .eq('direction', 'treatwell→us')
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1);
      watermark = lastLog?.length
        ? new Date(lastLog[0].created_at).getTime()
        : Date.now() - 60 * 60 * 1000;
    }

    // Piccola sovrapposizione di sicurezza (clock skew fra noi e Uala, poll persi)
    const updatedSince = new Date(watermark - SYNC_OVERLAP_MS).toISOString();

    const data = await twClient.getSync(updatedSince);
    const appointments: any[] = data?.data?.appointments || [];
    if (process.env.TREATWELL_DEBUG === '1') {
      console.log(`[tw-debug:window] since=${updatedSince} → ${appointments.length} appuntamenti`);
    }

    for (const tw of appointments) {
      const twId = String(tw.id);
      logPayloadShape(tw, 'sync');

      // ── CANCELLED ──
      if (isCancelledState(tw.state)) {
        const { data: existing } = await supabase
          .from('appointments')
          .select('id, status')
          .eq('treatwell_appointment_id', twId)
          .limit(1);
        if (!existing?.length) continue;
        // Già cancellato: non riscrivere, altrimenti ogni poll emette un evento
        // Realtime e il calendario si ricarica in loop.
        if (existing[0].status === 'cancelled') continue;

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
      // Prova per telefono normalizzato, poi per treatwell_client_id, infine crea con solo nome
      let clientId: string | null = null;
      const rawPhone = tw.customer_phone_number || '';
      const phone = rawPhone ? normalizePhone(rawPhone) : '';
      const name = (tw.customer_full_name || '').trim();
      const twCustomerId = tw.customer_id ? String(tw.customer_id) : '';

      if (phone) {
        // Cerca per telefono normalizzato
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

      // Sincronizza email cliente da Uala
      if (clientId && twCustomerId) {
        syncClientEmail(supabase, twClient, clientId, twCustomerId);
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
      const duration = extractDuration(tw);
      const startTime = tw.time;
      const endTime = new Date(
        new Date(startTime).getTime() + duration * 1000,
      ).toISOString();

      // ── UPSERT: cerca per treatwell_appointment_id, aggiorna se esiste, altrimenti crea ──
      const { data: existing } = await supabase
        .from('appointments')
        .select('id, start_time, end_time, stylist_id, service_id, client_id, buffer_end_time, status')
        .eq('treatwell_appointment_id', twId)
        .eq('salon_id', salonId)
        .limit(1);

      if (existing?.length) {
        const current = existing[0];
        const desired = buildDesiredRow(tw, current, startTime, endTime, stylist?.[0]?.id, serviceId, clientId);

        // Scrivi SOLO se qualcosa è davvero cambiato: ogni UPDATE emette un evento
        // Realtime, il calendario ricarica, il GET rilancia un poll → loop infinito.
        if (!hasChanges(current, desired)) continue;

        await supabase.from('appointments').update(desired).eq('id', current.id);
      } else {
        await supabase.from('appointments').insert({
          salon_id: salonId,
          client_id: clientId,
          stylist_id: stylist?.[0]?.id,
          service_id: serviceId,
          start_time: startTime,
          end_time: endTime,
          buffer_end_time: endTime,
          status: 'confirmed',
          source: 'treatwell',
          treatwell_appointment_id: twId,
        });
      }

      await supabase.from('sync_log').insert({
        salon_id: salonId,
        direction: 'treatwell→us',
        status: 'success',
        external_id: twId,
      });
    }

    // Watermark = istante di LETTURA, non di scrittura (vedi commento sopra)
    lastSyncAt.set(salonId, readAt);
    // ── FULL LOAD: recupera appuntamenti di oggi e prossimi giorni ──
    // synch.json da solo non basta: appuntamenti creati giorni fa hanno
    // updated_at vecchio e non compaiono nel delta.
    // Throttlato: max 1 volta ogni 30 minuti
    const now = Date.now();
    const last = lastFullLoad.get(salonId) || 0;
    if (now - last > 30 * 60 * 1000) {
      lastFullLoad.set(salonId, now);
      await fullLoadRecent(salonId, twClient, supabase);
    }
  } catch (e: any) {
    console.error('Poll error for salon', salonId, e);
  } finally {
    polling.delete(salonId);
  }
}

/** Full load degli appuntamenti dei prossimi 7 giorni.
 *  Importa solo quelli che non abbiamo già (per treatwell_appointment_id). */
async function fullLoadRecent(salonId: string, twClient: TreatwellClient, supabase: ReturnType<typeof createAdminClient>) {
  const today = new Date();
  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];

    let appointments: any[];
    try {
      appointments = await twClient.getAppointments(dateStr);
    } catch {
      continue; // giorno senza dati o errore API
    }

    for (const tw of appointments) {
      const twId = String(tw.id);
      logPayloadShape(tw, 'fullload');
      // Salta cancellati/eliminati/scartati
      if (isCancelledState(tw.state)) continue;

      // Cerca l'appuntamento esistente: se c'è lo aggiorniamo (auto-riparazione
      // di eventuali disallineamenti di orario/durata), altrimenti lo creiamo.
      const { data: existing } = await supabase
        .from('appointments')
        .select('id, start_time, end_time, buffer_end_time, stylist_id, service_id, client_id, status')
        .eq('treatwell_appointment_id', twId)
        .eq('salon_id', salonId)
        .limit(1);

      // Risolvi cliente
      let clientId: string | null = null;
      const rawPhone = tw.customer_phone_number || '';
      const phone = rawPhone ? normalizePhone(rawPhone) : '';
      const name = (tw.customer_full_name || '').trim();
      const twCustomerId = tw.customer_id ? String(tw.customer_id) : '';

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
          const [firstName, ...lastParts] = name.split(' ');
          const { data: newClient } = await supabase
            .from('clients')
            .insert({ salon_id: salonId, first_name: firstName || 'Cliente', last_name: lastParts.join(' ') || '', phone, treatwell_client_id: twCustomerId })
            .select('id').single();
          if (newClient) clientId = newClient.id;
        }
      } else if (twCustomerId) {
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('salon_id', salonId)
          .eq('treatwell_client_id', twCustomerId)
          .limit(1);
        if (client?.length) clientId = client[0].id;
      }

      if (!clientId && name && name !== 'Cliente') {
        const [firstName, ...lastParts] = name.split(' ');
        const { data: newClient } = await supabase
          .from('clients')
          .insert({ salon_id: salonId, first_name: firstName || name, last_name: lastParts.join(' ') || '', phone: null, treatwell_client_id: twCustomerId })
          .select('id').single();
        if (newClient) clientId = newClient.id;
      }

      // Sincronizza email cliente da Uala
      if (clientId && twCustomerId) {
        syncClientEmail(supabase, twClient, clientId, twCustomerId);
      }

      // Risolvi stylist
      const { data: stylist } = await supabase
        .from('users')
        .select('id')
        .eq('uala_staff_id', tw.staff_member_id)
        .eq('salon_id', salonId)
        .limit(1);

      // Risolvi servizio
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

      // Durata
      const duration = extractDuration(tw);
      const startTime = tw.time;
      const endTime = new Date(new Date(startTime).getTime() + duration * 1000).toISOString();

      if (existing?.length) {
        // Auto-riparazione: riallinea orario/durata/stylist a quanto c'è su Uala,
        // ma solo se differisce davvero (altrimenti eventi Realtime a vuoto).
        const current = existing[0];
        const desired = buildDesiredRow(tw, current, startTime, endTime, stylist?.[0]?.id, serviceId, clientId);
        if (!hasChanges(current, desired)) continue;

        await supabase.from('appointments').update(desired).eq('id', current.id);
      } else {
        await supabase.from('appointments').insert({
          salon_id: salonId,
          client_id: clientId,
          stylist_id: stylist?.[0]?.id,
          service_id: serviceId,
          start_time: startTime,
          end_time: endTime,
          buffer_end_time: endTime,
          status: 'confirmed',
          source: 'treatwell',
          treatwell_appointment_id: twId,
        });
      }
    }
  }
}
