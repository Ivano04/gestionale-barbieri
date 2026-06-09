import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes } from 'date-fns';
import { sendN8nEvent } from '@/lib/sync-webhook';
import { fetchServiceDuration } from '@/services/booking-engine/queries';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const adminSupabase = createAdminClient();
  const body = await request.json();

  const { data: existing } = await supabase
    .from('appointments')
    .select('stylist_id, service_id, salon_id, start_time, end_time, buffer_end_time')
    .eq('id', id)
    .single();

  if (!existing) {
    return Response.json({ error: 'Appuntamento non trovato' }, { status: 404 });
  }

  let newEndTime = body.end_time;
  let newBufferEndTime = body.buffer_end_time;
  const newStylistId = body.stylist_id ?? existing.stylist_id;
  const newStartTime = body.start_time ?? existing.start_time;

  // Recalculate end times if service changed or start moved
  if (body.start_time || body.service_id) {
    const serviceId = body.service_id ?? existing.service_id;
    if (!serviceId) {
      return Response.json({ error: 'Servizio non specificato' }, { status: 400 });
    }

    const duration = await fetchServiceDuration(serviceId);
    if (!duration) return Response.json({ error: 'Servizio non trovato' }, { status: 404 });

    const bufferMinutes = body.buffer_time_minutes ?? 0;
    const startTimeDate = new Date(newStartTime);
    newEndTime = addMinutes(startTimeDate, duration).toISOString();
    newBufferEndTime = addMinutes(startTimeDate, duration + bufferMinutes).toISOString();
  }

  if (new Date(newStartTime) < new Date()) {
    return Response.json({ error: 'Non puoi spostare un appuntamento nel passato' }, { status: 400 });
  }

  // Time blocks check
  let blockQuery = adminSupabase
    .from('time_blocks')
    .select('id')
    .eq('salon_id', existing.salon_id)
    .lt('start_time', newBufferEndTime || newEndTime)
    .gt('end_time', newStartTime);

  if (newStylistId) {
    blockQuery = blockQuery.or(`stylist_id.eq.${newStylistId},stylist_id.is.null`);
  } else {
    blockQuery = blockQuery.is('stylist_id', null);
  }
  const { data: blocks } = await blockQuery.limit(1);
  if (blocks?.length) {
    return Response.json({ error: 'Questo slot non è disponibile (fascia bloccata)' }, { status: 409 });
  }

  // Simple conflict check
  if (newStylistId) {
    const { data: conflict } = await supabase
      .from('appointments')
      .select('id, client:clients(first_name)')
      .eq('stylist_id', newStylistId)
      .eq('salon_id', existing.salon_id)
      .lt('start_time', newBufferEndTime || newEndTime)
      .gt('end_time', newStartTime)
      .neq('status', 'cancelled')
      .neq('id', id)
      .limit(1);

    if (conflict?.length) {
      const cli = conflict[0].client as any;
      return Response.json({
        error: `Conflitto con appuntamento di ${cli?.first_name || 'cliente'}`,
        conflict: { appointmentId: conflict[0].id },
      }, { status: 409 });
    }
  }

  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    clean[k] = v === '' ? null : v;
  }

  if (newEndTime) clean.end_time = newEndTime;
  if (newBufferEndTime) clean.buffer_end_time = newBufferEndTime;

  const { data, error } = await supabase
    .from('appointments')
    .update(clean)
    .eq('id', id)
    .select('*, client:clients(*), stylist:users(*), service:services(*)')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const moved = body.start_time || body.stylist_id;
  const extended = body.end_time && !moved;
  const eventType: any = moved ? 'appointment.moved' : extended ? 'appointment.extended' : 'appointment.updated';

  sendN8nEvent(eventType, {
    id: data.id,
    salon_id: data.salon_id,
    ghl_appointment_id: data.ghl_appointment_id,
    treatwell_appointment_id: data.treatwell_appointment_id,
    changes: clean,
  });

  return Response.json(data);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const adminSupabase = createAdminClient();
  const { data: existing } = await adminSupabase
    .from('appointments')
    .select('ghl_appointment_id, treatwell_appointment_id, salon_id')
    .eq('id', id)
    .single();

  const { error } = await adminSupabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  sendN8nEvent('appointment.cancelled', {
    id,
    salon_id: existing?.salon_id,
    ghl_appointment_id: existing?.ghl_appointment_id,
    treatwell_appointment_id: existing?.treatwell_appointment_id,
  });

  return Response.json({ status: 'ok' });
}
