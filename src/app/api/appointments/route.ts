import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes } from 'date-fns';
import { getRomeOffset } from '@/lib/date-utils';
import { sendN8nEvent } from '@/lib/sync-webhook';
import { fetchServiceDuration } from '@/services/booking-engine/queries';
import { pushToGHL } from '@/services/ghl-sync/sync';
import { pushToTreatwell } from '@/services/treatwell-sync/sync';
import { pollTreatwell } from '@/services/treatwell-sync/poller';
import { TreatwellClient } from '@/services/treatwell-sync/client';
import { pollGHL } from '@/services/ghl-sync/poller';
import { normalizeShifts, type WorkingHoursShift } from '@/lib/working-hours';
import { computeBusyPeriods } from '@/services/booking-engine/overlap';

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

  // Trigger Treatwell poll (fire-and-forget, throttled internally)
  if (process.env.TREATWELL_API_TOKEN) {
    const twClient = new TreatwellClient({
      baseUrl: process.env.TREATWELL_API_BASE_URL || 'https://api.uala.it/api/v1',
      venueId: process.env.TREATWELL_VENUE_ID || '482',
      token: process.env.TREATWELL_API_TOKEN,
      clientAuth: process.env.TREATWELL_CLIENT_AUTH || '',
    });
    pollTreatwell(salon_id, twClient).catch(() => {});
  }

  // Trigger GHL poll (fire-and-forget)
  if (process.env.GHL_AGENCY_API_KEY) {
    pollGHL(salon_id).catch(() => {});
  }

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

    const dayShifts = normalizeShifts(wh?.[dayName]);

    // If custom hours exist and day is explicitly null → closed
    if (Object.keys(wh || {}).length > 0 && wh?.[dayName] === null) {
      return Response.json({ error: 'Salone chiuso in questa data' }, { status: 400 });
    }

    // If day has no shifts (and no custom hours override) → use defaults
    const shifts: WorkingHoursShift[] = dayShifts || [
      { open: salonHoursData.open_time || '09:00', close: salonHoursData.close_time || '19:00' },
    ];

    const slotTime = body.start_time.split('T')[1]?.substring(0, 5) || '';
    const endSlotTime = bufferEndTime.split('T')[1]?.substring(0, 5) || '';

    // Check if appointment fits within any shift
    const fits = shifts.some(s => slotTime >= s.open && endSlotTime <= s.close);
    if (!fits) {
      const ranges = shifts.map(s => `${s.open}-${s.close}`).join(', ');
      return Response.json({ error: `Orario fuori dalle fasce: ${ranges}` }, { status: 400 });
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

  // Conflict check con fasi: la posa (processing) non blocca
  if (body.stylist_id) {
    const { data: conflicts } = await supabase
      .from('appointments')
      .select('id, start_time, end_time, service_id, client:clients(first_name)')
      .eq('stylist_id', body.stylist_id)
      .eq('salon_id', body.salon_id)
      .lt('start_time', bufferEndTime)
      .gt('end_time', body.start_time)
      .neq('status', 'cancelled');

    if (conflicts?.length) {
      // Fetch service phases for all conflicting appointments
      const svcIds = [...new Set(conflicts.map((c: any) => c.service_id).filter(Boolean))];
      const { data: services } = svcIds.length > 0
        ? await supabase.from('services').select('id, duration_application, duration_processing, duration_finishing').in('id', svcIds as string[])
        : { data: [] };
      const svcMap = new Map((services || []).map((s: any) => [s.id, s]));

      const newStart = new Date(body.start_time);
      const newEnd = new Date(bufferEndTime);

      for (const c of conflicts) {
        const svc = (svcMap as Map<string, any>).get(c.service_id as string);
        const busyPeriods = svc
          ? computeBusyPeriods(new Date(c.start_time), new Date(c.end_time), svc.duration_application, svc.duration_processing, svc.duration_finishing)
          : [{ start: new Date(c.start_time), end: new Date(c.end_time) }];

        // Controlla se il nuovo appuntamento si sovrappone a un periodo BUSY
        const overlaps = busyPeriods.some(bp => newStart < bp.end && newEnd > bp.start);
        if (overlaps) {
          const cli = c.client as any;
          return Response.json({
            error: `Conflitto con appuntamento di ${cli?.first_name || 'cliente'}`,
            conflict: { appointmentId: c.id },
          }, { status: 409 });
        }
      }
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
  }

  // Sync verso Treatwell/Uala — awaited to prevent tree-shaking
  try {
    await pushToTreatwell(fullAppt as any, (fullAppt as any).client);
  } catch (err: any) {
    console.error('[treatwell] sync failed:', err);
  }

  return Response.json(appointment, { status: 201 });
}
