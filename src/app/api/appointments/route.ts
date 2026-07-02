import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes } from 'date-fns';
import { getRomeOffset } from '@/lib/date-utils';
import { sendN8nEvent } from '@/lib/sync-webhook';
import { fetchServiceDuration } from '@/services/booking-engine/queries';
import { pushToGHL } from '@/services/ghl-sync/sync';
import { pushToTreatwell } from '@/services/treatwell-sync/sync';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const date = searchParams.get('date');
  const stylist_id = searchParams.get('stylist_id');

  if (!salon_id || !date) {
    return Response.json({ error: 'salon_id and date required' }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const tzOffset = getRomeOffset(date);
  const dayStart = new Date(`${date}T00:00:00${tzOffset}`);
  const dayEnd = new Date(`${date}T23:59:59${tzOffset}`);

  let query = supabase
    .from('appointments')
    .select('*, client:clients(*), stylist:users(*), service:services(*)')
    .eq('salon_id', salon_id)
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString())
    .neq('status', 'cancelled')
    .order('start_time');

  if (stylist_id) query = query.eq('stylist_id', stylist_id);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();
  const supabase = await createServerSupabase();
  const adminSupabase = createAdminClient();

  const duration = await fetchServiceDuration(body.service_id);
  if (!duration) return Response.json({ error: 'Servizio non trovato' }, { status: 404 });

  const bufferMinutes = body.buffer_time_minutes ?? 0;
  const startTime = new Date(body.start_time);
  const endTime = addMinutes(startTime, duration).toISOString();
  const bufferEndTime = addMinutes(startTime, duration + bufferMinutes).toISOString();

  if (startTime < new Date()) {
    return Response.json({ error: 'Non puoi prenotare nel passato' }, { status: 400 });
  }

  // Salon hours check
  const dateStr = body.start_time.split('T')[0];
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayName = dayNames[new Date(dateStr + 'T12:00:00').getDay()];

  const { data: salonHoursData } = await supabase
    .from('salons')
    .select('working_hours, open_time, close_time')
    .eq('id', body.salon_id)
    .single();

  if (salonHoursData) {
    let wh = (salonHoursData.working_hours || {}) as Record<string, any>;
    if (typeof wh === 'string') try { wh = JSON.parse(wh); } catch {}

    if (wh?.[dayName] === null) {
      return Response.json({ error: 'Salone chiuso in questa data' }, { status: 400 });
    }

    const openTime = wh?.[dayName]?.open || salonHoursData.open_time || '09:00';
    const closeTime = wh?.[dayName]?.close || salonHoursData.close_time || '19:00';

    const slotTime = body.start_time.split('T')[1]?.substring(0, 5) || '';
    if (slotTime < openTime || slotTime >= closeTime) {
      return Response.json({ error: `Orario fuori dalla fascia ${openTime}-${closeTime}` }, { status: 400 });
    }

    const endSlotTime = bufferEndTime.split('T')[1]?.substring(0, 5) || '';
    if (endSlotTime > closeTime) {
      return Response.json({ error: `L'appuntamento sfora l'orario di chiusura (${closeTime})` }, { status: 400 });
    }
  }

  // Time blocks check
  let blockQuery = adminSupabase
    .from('time_blocks')
    .select('id')
    .eq('salon_id', body.salon_id)
    .lt('start_time', bufferEndTime)
    .gt('end_time', body.start_time);
  if (body.stylist_id) blockQuery = blockQuery.or(`stylist_id.eq.${body.stylist_id},stylist_id.is.null`);
  else blockQuery = blockQuery.is('stylist_id', null);
  const { data: blocks } = await blockQuery.limit(1);
  if (blocks?.length) {
    return Response.json({ error: 'Questo slot non è disponibile (fascia bloccata)' }, { status: 409 });
  }

  // Simple conflict check — any overlap is a hard block
  if (body.stylist_id) {
    const { data: conflict } = await supabase
      .from('appointments')
      .select('id, client:clients(first_name)')
      .eq('stylist_id', body.stylist_id)
      .eq('salon_id', body.salon_id)
      .lt('start_time', bufferEndTime)
      .gt('end_time', body.start_time)
      .neq('status', 'cancelled')
      .limit(1);

    if (conflict?.length) {
      const cli = conflict[0].client as any;
      return Response.json({
        error: `Conflitto con appuntamento di ${cli?.first_name || 'cliente'}`,
        conflict: { appointmentId: conflict[0].id },
      }, { status: 409 });
    }
  }

  // Resolve client
  let clientId = body.client_id;
  if (!clientId && body.client) {
    const { data: existing } = await supabase
      .from('clients').select('id')
      .eq('salon_id', body.salon_id).eq('phone', body.client.phone).limit(1);
    if (existing?.length) {
      clientId = existing[0].id;
    } else {
      const { data: newClient } = await supabase
        .from('clients').insert({ salon_id: body.salon_id, ...body.client })
        .select('id').single();
      if (newClient) clientId = newClient.id;
    }
  }

  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      salon_id: body.salon_id,
      client_id: clientId,
      stylist_id: body.stylist_id,
      service_id: body.service_id,
      start_time: body.start_time,
      end_time: endTime,
      buffer_end_time: bufferEndTime,
      source: body.source || 'manual',
      notes: body.notes,
      added_services: [],
    })
    .select('*')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: fullAppt } = await supabase
  .from('appointments')
  .select('*, client:clients(*), service:services(*), stylist:users(id, full_name, ghl_calendar_id, uala_staff_id)')
  .eq('id', appointment.id)
  .single();

  sendN8nEvent('appointment.created', {
    id: appointment.id,
    salon_id: appointment.salon_id,
    stylist_id: appointment.stylist_id,
    client_id: appointment.client_id,
    service_id: appointment.service_id,
    start_time: appointment.start_time,
    end_time: appointment.end_time,
    buffer_end_time: appointment.buffer_end_time,
    source: appointment.source,
    ghl_appointment_id: appointment.ghl_appointment_id,
    treatwell_appointment_id: appointment.treatwell_appointment_id,
  });
  // Fire-and-forget sync verso GHL
  if (fullAppt?.client) {
    pushToGHL(fullAppt as any, fullAppt.client as any).catch(err => {
      console.error('[ghl] sync failed:', err);
    });
    // Sync verso Treatwell/Uala (stesso blocco per evitare tree-shaking)
    pushToTreatwell(fullAppt as any, fullAppt.client).catch(err => {
      console.error('[treatwell] sync failed:', err);
    });
  }

  return Response.json(appointment, { status: 201 });
}
