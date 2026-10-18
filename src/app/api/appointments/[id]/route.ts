import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAppointmentTiming } from '@/services/appointments/timing';
import { sendN8nEvent } from '@/lib/sync-webhook';
import { computeBusyPeriods } from '@/services/booking-engine/overlap';
import { updateGHLAppointment } from '@/services/ghl-sync/sync';
import { pushUpdateToTreatwell } from '@/services/treatwell-sync/sync';
import { cancelAndMaybeRefund } from '@/services/cancellation/service';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const adminSupabase = createAdminClient();
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Dati non validi' }, { status: 400 });

  if (body.client && !body.client_id) return Response.json({ error: 'Seleziona un cliente esistente prima di salvare la modifica.' }, { status: 400 });

  const { data: existing } = await supabase
    .from('appointments')
    .select('stylist_id, service_id, salon_id, start_time, end_time, buffer_end_time')
    .eq('id', id)
    .single();

  if (!existing) {
    return Response.json({ error: 'Appuntamento non trovato' }, { status: 404 });
  }

  const newStylistId = body.stylist_id ?? existing.stylist_id;
  const serviceId = body.service_id ?? existing.service_id;
  let serviceTiming;
  if (serviceId !== existing.service_id) {
    const { data: service } = await supabase.from('services').select('duration_minutes, buffer_time_minutes')
      .eq('id', serviceId).eq('salon_id', existing.salon_id).single();
    if (!service) return Response.json({ error: 'Servizio non trovato' }, { status: 404 });
    serviceTiming = service;
  }
  let timing;
  try { timing = resolveAppointmentTiming(existing, body, serviceTiming); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Orari non validi' }, { status: 400 }); }
  const newStartTime = timing.start_time;
  const newEndTime = timing.end_time;
  const newBufferEndTime = timing.buffer_end_time;

  // Se lo stylist cambia, verifica che possa fare questo servizio
  if (body.stylist_id && serviceId) {
    const { data: assignments } = await supabase
      .from('stylist_services')
      .select('stylist_id');
    const hasAnyAssignments = (assignments || []).length > 0;
    if (hasAnyAssignments) {
      const assigned = (assignments || []).filter(a => a.stylist_id === body.stylist_id);
      const isAssignedToService = assigned.length > 0; // ha ALMENO un'assegnazione
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

  // Ignore joined client/service/stylist objects returned by the calendar GET.
  const clean: Record<string, unknown> = { ...timing };
  for (const key of ['client_id', 'service_id', 'stylist_id', 'status', 'source', 'notes']) {
    if (Object.hasOwn(body, key)) clean[key] = body[key] === '' ? null : body[key];
  }

  const { data, error } = await supabase
    .from('appointments')
    .update(clean)
    .eq('id', id)
    .select('*, client:clients(*), stylist:users(*), service:services(*)')
    .single();

  if (error) return Response.json({ error: error.code === '23P01' ? 'Lo slot non è più disponibile. Aggiorna il calendario.' : error.message }, { status: error.code === '23P01' ? 409 : 500 });

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
  if (data.treatwell_appointment_id && data.salon_id) {
    const stylist = data.stylist as any;
    const service = data.service as any;
    pushUpdateToTreatwell(
      data.treatwell_appointment_id,
      data.salon_id,
      data.id,
      {
        startTime: data.start_time,
        endTime: data.end_time,
        ualaStaffId: stylist?.uala_staff_id,
        ualaTreatmentId: service?.uala_treatment_id,
      },
    ).catch(err => { console.error('[treatwell] update failed:', err); });
  }

  return Response.json(data);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: 'Non autenticato' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('salon_id').eq('id', user.id).single();
  const { data: appointment } = await supabase.from('appointments').select('id')
    .eq('id', id).eq('salon_id', profile?.salon_id ?? '').maybeSingle();
  if (!appointment) return Response.json({ error: 'Appuntamento non trovato' }, { status: 404 });
  // Annullo lato staff: soft-cancel + sync esterni + rimborso automatico (policy staff)
  // + email di annullamento. Logica centralizzata nel servizio di cancellazione.
  const result = await cancelAndMaybeRefund(id, 'staff');
  if (!result.ok) return Response.json({ error: 'Appuntamento non trovato' }, { status: 404 });
  return Response.json({ status: 'ok', refunded: result.refunded, refundPending: !!result.refundPending, refundStatus: result.refundStatus });
}
