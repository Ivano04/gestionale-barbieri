import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes } from 'date-fns';
import { getRomeOffset } from '@/lib/date-utils';

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

  const { data: service } = await supabase
    .from('services').select('duration_minutes').eq('id', body.service_id).single();
  if (!service) return Response.json({ error: 'Servizio non trovato' }, { status: 404 });

  const endTime = addMinutes(new Date(body.start_time), service.duration_minutes).toISOString();

  // Past booking check
  if (new Date(body.start_time) < new Date()) {
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

    const endSlotTime = endTime.split('T')[1]?.substring(0, 5) || '';
    if (endSlotTime > closeTime) {
      return Response.json({ error: `L'appuntamento sfora l'orario di chiusura (${closeTime})` }, { status: 400 });
    }
  }

  // Check time blocks using admin client (bypass RLS)
  const adminSupabase = createAdminClient();
  let blockQuery = adminSupabase
    .from('time_blocks')
    .select('id')
    .eq('salon_id', body.salon_id)
    .lt('start_time', endTime)
    .gt('end_time', body.start_time);
  if (body.stylist_id) blockQuery = blockQuery.or(`stylist_id.eq.${body.stylist_id},stylist_id.is.null`);
  else blockQuery = blockQuery.is('stylist_id', null);
  const { data: blocks } = await blockQuery.limit(1);
  if (blocks?.length) {
    return Response.json({ error: 'Questo slot non è disponibile (fascia bloccata)' }, { status: 409 });
  }

  const { data: conflict } = await supabase
    .from('appointments').select('id')
    .eq('stylist_id', body.stylist_id)
    .eq('salon_id', body.salon_id)
    .lt('start_time', endTime)
    .gt('end_time', body.start_time)
    .neq('status', 'cancelled')
    .limit(1);
  if (conflict?.length) {
    return Response.json({ error: 'Slot già occupato' }, { status: 409 });
  }

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
      source: body.source || 'manual',
      notes: body.notes,
    })
    .select('*')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(appointment, { status: 201 });
}
