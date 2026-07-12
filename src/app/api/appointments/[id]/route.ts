import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes } from 'date-fns';
import { sendN8nEvent } from '@/lib/sync-webhook';
import { fetchServiceDuration } from '@/services/booking-engine/queries';
import { computeBusyPeriods } from '@/services/booking-engine/overlap';
import { updateGHLAppointment, deleteGHLAppointment } from '@/services/ghl-sync/sync';
import { deleteFromTreatwell, pushUpdateToTreatwell } from '@/services/treatwell-sync/sync';

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
  const serviceId = body.service_id ?? existing.service_id;

  // Se lo stylist cambia, verifica che possa fare questo servizio
  if (body.stylist_id && serviceId) {
    const { data: assignments } = await supabase
      .from('stylist_services')
      .select('stylist_id');
    const hasAnyAssignments = (assignments || []).length > 0;
    if (hasAnyAssignments) {
      const assigned = (assignments || []).filter(a => a.stylist_id === body.stylist_id);
      const isAssignedToService = assigned.some(a => true); // ha ALMENO un'assegnazione
      const { data: specificAssignment } = await supabase
        .from('stylist_services')
        .select('stylist_id')
        .eq('stylist_id', body.stylist_id)
        .eq('service_id', serviceId)
        .limit(1);
      const canDoService = (specificAssignment || []).length > 0 || !isAssignedToService;
      if (!canDoService) {
        return Response.json({ error: 'Questo operatore non può svolgere il servizio selezionato' }, { status: 400 });
      }
    }
  }

  // Recalculate end times if service changed or start moved (ma non se end_time è già passato)
  if ((body.start_time || body.service_id) && !body.end_time) {
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

  // Conflict check con fasi: la posa (processing) non blocca
  if (newStylistId) {
    const { data: conflicts } = await supabase
      .from('appointments')
      .select('id, start_time, end_time, service_id, client:clients(first_name)')
      .eq('stylist_id', newStylistId)
      .eq('salon_id', existing.salon_id)
      .lt('start_time', newBufferEndTime || newEndTime)
      .gt('end_time', newStartTime)
      .neq('status', 'cancelled')
      .neq('id', id);

    if (conflicts?.length) {
      const svcIds = [...new Set(conflicts.map((c: any) => c.service_id).filter(Boolean))];
      const { data: services } = svcIds.length > 0
        ? await supabase.from('services').select('id, duration_application, duration_processing, duration_finishing').in('id', svcIds as string[])
        : { data: [] };
      const svcMap = new Map((services || []).map((s: any) => [s.id, s]));

      const newStart = new Date(newStartTime);
      const newEnd = new Date(newBufferEndTime || newEndTime);

      for (const c of conflicts) {
        const svc = (svcMap as Map<string, any>).get(c.service_id as string);
        const busyPeriods = svc
          ? computeBusyPeriods(new Date(c.start_time), new Date(c.end_time), svc.duration_application, svc.duration_processing, svc.duration_finishing)
          : [{ start: new Date(c.start_time), end: new Date(c.end_time) }];

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

  // Sync update to GHL
  if (data.ghl_appointment_id && data.salon_id) {
    const ghlData: { title?: string; startTime?: string; endTime?: string } = {};
    if (data.start_time) ghlData.startTime = data.start_time;
    if (data.end_time) ghlData.endTime = data.end_time;
    if (data.service?.name) ghlData.title = data.service.name;
    if (Object.keys(ghlData).length > 0) {
      updateGHLAppointment(data.ghl_appointment_id, data.salon_id, data.id, ghlData).catch(err => {
        console.error('[ghl] update failed:', err);
      });
    }
  }

  // Sync update to Treatwell
  if (data.treatwell_appointment_id && data.salon_id && (data.start_time || data.end_time)) {
    pushUpdateToTreatwell(
      data.treatwell_appointment_id,
      data.salon_id,
      data.id,
      { startTime: data.start_time, endTime: data.end_time },
    ).catch(err => { console.error('[treatwell] update failed:', err); });
  }

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

  // Sync deletion to GHL
  if (existing?.ghl_appointment_id && existing?.salon_id) {
    deleteGHLAppointment(existing.ghl_appointment_id, existing.salon_id, id).catch(err => {
      console.error('[ghl] delete failed:', err);
    });
  }

  // Sync deletion to Treatwell/Uala
  if (existing?.treatwell_appointment_id && existing?.salon_id) {
    deleteFromTreatwell(existing.treatwell_appointment_id, existing.salon_id, id).catch(err => {
      console.error('[treatwell] delete failed:', err);
    });
  }

  return Response.json({ status: 'ok' });
}
