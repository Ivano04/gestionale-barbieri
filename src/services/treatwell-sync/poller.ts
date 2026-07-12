import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';

/** Lock anti-concorrenza per salone: valore = istante di acquisizione.
 *  NON è un Set: se un poll muore o si pianta senza rilasciare il lock, ogni
 *  poll successivo uscirebbe subito e il sync Treatwell resterebbe spento fino
 *  al riavvio del processo. Con il timestamp possiamo scavalcare un lock stantio. */
const polling = new Map<string, number>();
/** Oltre questa soglia un lock è considerato orfano e viene scavalcato. */
const POLL_LOCK_TTL_MS = 3 * 60 * 1000;
/** Watermark per salone, ancorato all'istante di LETTURA da Uala.
 *  In memoria: al riavvio si riparte dall'ultimo sync_log riuscito. */
const lastSyncAt = new Map<string, number>();
/** Sovrapposizione di sicurezza della finestra di sync (clock skew, poll persi). */
const SYNC_OVERLAP_MS = 2 * 60 * 1000;

// ── Riallineamento con Uala (l'unico canale che vede gli edit) ──
/** Passata veloce sui giorni caldi: leggera, così un refresh la fa scattare. */
const lastFastSync = new Map<string, number>();
const FAST_SYNC_INTERVAL_MS = 20 * 1000;
const FAST_SYNC_DAYS = 3;
/** Passata profonda sull'intera finestra, per la coda dei giorni successivi. */
const lastFullLoad = new Map<string, number>();
const DEEP_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const DEEP_SYNC_DAYS = 7;

/** Registra un fallimento di scrittura in sync_log.
 *  Senza questo gli errori di insert/update passavano inosservati: il codice
 *  non controllava `error` e la route inghiotte tutto con .catch(() => {}). */
async function logSyncFailure(
  supabase: ReturnType<typeof createAdminClient>,
  salonId: string,
  twId: string,
  message: string,
) {
  await supabase.from('sync_log').insert({
    salon_id: salonId,
    direction: 'treatwell→us',
    status: 'failed',
    external_id: twId,
    error_message: message,
  });
}

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
  // Anti-concorrenza: se un poll è già in corso per questo salone, esci.
  // Ma se il lock è più vecchio del TTL, il poll che lo teneva è morto o
  // impiantato: lo scavalchiamo, altrimenti il sync resterebbe fermo per sempre.
  const heldSince = polling.get(salonId);
  if (heldSince !== undefined && Date.now() - heldSince < POLL_LOCK_TTL_MS) return;
  if (heldSince !== undefined) {
    console.warn(`[treatwell] lock orfano da ${Math.round((Date.now() - heldSince) / 1000)}s, lo scavalco`);
  }
  polling.set(salonId, Date.now());

  try {
    // NB: dentro il try — se lanciasse qui fuori, il `finally` non scatterebbe
    // e il flag `polling` resterebbe alzato per sempre, bloccando ogni poll futuro.
    const supabase = createAdminClient();
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

    for (const tw of appointments) {
      const twId = String(tw.id);

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

        const { error } = await supabase.from('appointments').update(desired).eq('id', current.id);
        if (error) {
          console.error(`[treatwell] UPDATE fallita per ${twId}:`, error.message);
          await logSyncFailure(supabase, salonId, twId, error.message);
          continue;
        }
      } else {
        const { error } = await supabase.from('appointments').insert({
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
        if (error) {
          console.error(`[treatwell] INSERT fallita per ${twId}:`, error.message);
          await logSyncFailure(supabase, salonId, twId, error.message);
          continue;
        }
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

    // ── RIALLINEAMENTO CON UALA ──
    // synch.json (sopra) riporta di fatto solo creazioni e cancellazioni: le
    // modifiche in-place (spostamenti, cambi durata) NON ci passano. L'unico modo
    // di vederle è rileggere gli appuntamenti da Uala e confrontarli.
    const now = Date.now();

    // Passata veloce sui giorni "caldi": leggera (poche query batch), gira quasi
    // a ogni refresh, così uno spostamento su Treatwell compare entro pochi secondi.
    const lastFast = lastFastSync.get(salonId) || 0;
    if (now - lastFast > FAST_SYNC_INTERVAL_MS) {
      lastFastSync.set(salonId, now);
      await syncRange(salonId, twClient, supabase, FAST_SYNC_DAYS);
    }

    // Passata profonda sull'intera finestra, per la coda dei giorni successivi.
    const lastDeep = lastFullLoad.get(salonId) || 0;
    if (now - lastDeep > DEEP_SYNC_INTERVAL_MS) {
      lastFullLoad.set(salonId, now);
      await syncRange(salonId, twClient, supabase, DEEP_SYNC_DAYS);
    }
  } catch (e: any) {
    console.error('Poll error for salon', salonId, e);
  } finally {
    polling.delete(salonId);
  }
}

/** Risolve (o crea) il cliente locale a partire da un appuntamento Uala.
 *  Costoso: fa query e, per i nuovi, una INSERT. Va chiamato SOLO quando
 *  stiamo inserendo un appuntamento nuovo — mai per quelli già esistenti,
 *  altrimenti a ogni passata rischiamo di duplicare clienti senza telefono
 *  (phone NULL non è coperto dall'indice univoco) e di far cambiare
 *  client_id all'infinito, generando riscritture e refresh a catena. */
async function resolveClient(
  supabase: ReturnType<typeof createAdminClient>,
  twClient: TreatwellClient,
  salonId: string,
  tw: any,
): Promise<string | null> {
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

  if (clientId && twCustomerId) {
    syncClientEmail(supabase, twClient, clientId, twCustomerId);
  }

  return clientId;
}

/**
 * Riallinea gli appuntamenti dei prossimi `days` giorni a quanto risulta su Uala.
 *
 * È l'UNICO canale che vede le modifiche in-place (spostamenti, cambi durata):
 * synch.json riporta di fatto solo creazioni e cancellazioni, non gli edit.
 *
 * Ottimizzato per poter girare di frequente: invece di ~4 query per appuntamento
 * (N+1, ~1000 query per passata) fa una manciata di query batch e confronta in
 * memoria. Scrive solo dove c'è una differenza reale.
 */
async function syncRange(
  salonId: string,
  twClient: TreatwellClient,
  supabase: ReturnType<typeof createAdminClient>,
  days: number,
) {
  // 1. Leggi da Uala i giorni richiesti
  const today = new Date();
  const twAppts: any[] = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];
    try {
      twAppts.push(...(await twClient.getAppointments(dateStr)));
    } catch {
      continue; // giorno senza dati o errore API
    }
  }
  if (!twAppts.length) return;

  const twIds = twAppts.map(a => String(a.id));

  // 2. Batch: i nostri appuntamenti corrispondenti, in una sola query
  const { data: ourRows } = await supabase
    .from('appointments')
    .select('id, treatwell_appointment_id, start_time, end_time, buffer_end_time, stylist_id, service_id, client_id, status')
    .eq('salon_id', salonId)
    .in('treatwell_appointment_id', twIds);
  const ourMap = new Map((ourRows || []).map((r: any) => [r.treatwell_appointment_id, r]));

  // 3. Batch: mappe di lookup per stylist e servizi (2 query, non 2 per appuntamento)
  const [{ data: staff }, { data: svcs }] = await Promise.all([
    supabase.from('users').select('id, uala_staff_id').eq('salon_id', salonId).not('uala_staff_id', 'is', null),
    supabase.from('services').select('id, uala_treatment_id').eq('salon_id', salonId).not('uala_treatment_id', 'is', null),
  ]);
  const staffMap = new Map((staff || []).map((s: any) => [s.uala_staff_id, s.id]));
  const svcMap = new Map((svcs || []).map((s: any) => [s.uala_treatment_id, s.id]));

  for (const tw of twAppts) {
    const twId = String(tw.id);
    const current = ourMap.get(twId);

    // ── Cancellati su Uala ──
    if (isCancelledState(tw.state)) {
      if (current && current.status !== 'cancelled') {
        await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', current.id);
      }
      continue;
    }

    const duration = extractDuration(tw);
    const startTime = tw.time;
    const endTime = new Date(new Date(startTime).getTime() + duration * 1000).toISOString();
    const stylistId = staffMap.get(tw.staff_member_id);
    const serviceId = svcMap.get(tw.data?.staff_member_treatment?.venue_treatment_id) ?? null;

    if (current) {
      // Esistente: riallinea orario/durata/stylist/servizio.
      // Il cliente NON viene ririsolto (vedi resolveClient): teniamo quello attuale.
      const desired = buildDesiredRow(tw, current, startTime, endTime, stylistId, serviceId, null);
      if (!hasChanges(current, desired)) continue;
      const { error } = await supabase.from('appointments').update(desired).eq('id', current.id);
      if (error) {
        console.error(`[treatwell] UPDATE fallita per ${twId}:`, error.message);
        await logSyncFailure(supabase, salonId, twId, error.message);
      }
    } else {
      // Nuovo: solo qui paghiamo la risoluzione del cliente
      const clientId = await resolveClient(supabase, twClient, salonId, tw);
      const { error } = await supabase.from('appointments').insert({
        salon_id: salonId,
        client_id: clientId,
        stylist_id: stylistId,
        service_id: serviceId,
        start_time: startTime,
        end_time: endTime,
        buffer_end_time: endTime,
        status: 'confirmed',
        source: 'treatwell',
        treatwell_appointment_id: twId,
      });
      if (error) {
        console.error(`[treatwell] INSERT fallita per ${twId}:`, error.message);
        await logSyncFailure(supabase, salonId, twId, error.message);
      }
    }
  }
}
