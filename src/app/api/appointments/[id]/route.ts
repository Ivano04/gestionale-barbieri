import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes } from 'date-fns';
import { sendN8nEvent } from '@/lib/sync-webhook';
import { fetchServiceWithPhases } from '@/services/booking-engine/queries';
import { computePhaseBreakdown } from '@/services/booking-engine/phase-calculator';
import { checkSlotConflict } from '@/services/booking-engine/overlap';

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

  // If start_time/stylist/service changed, recalculate durations
  if (body.start_time || body.stylist_id || body.service_id) {
    const serviceId = body.service_id ?? existing.service_id;
    if (!serviceId) {
      return Response.json({ error: 'Servizio non specificato' }, { status: 400 });
    }

    const service = await fetchServiceWithPhases(serviceId);
    if (!service) return Response.json({ error: 'Servizio non trovato' }, { status: 404 });

    const phases = computePhaseBreakdown(service);
    const startTimeDate = new Date(newStartTime);
    newEndTime = addMinutes(startTimeDate, phases.totalClientVisible).toISOString();
    newBufferEndTime = addMinutes(startTimeDate, phases.totalInternal).toISOString();
  }

  // Validate past booking
  if (new Date(newStartTime) < new Date()) {
    return Response.json({ error: 'Non puoi spostare un appuntamento nel passato' }, { status: 400 });
  }

  // Check time blocks (hard block)
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

  // Phase-aware conflict detection (soft = warning, hard = block)
  const warnings: any[] = [];
  if (newStylistId) {
    const { data: conflicting } = await supabase
      .from('appointments')
      .select('id, stylist_id, start_time, end_time, buffer_end_time, client:clients(first_name, last_name), service:services(duration_minutes, duration_application, duration_processing, duration_finishing, buffer_time_minutes)')
      .eq('stylist_id', newStylistId)
      .eq('salon_id', existing.salon_id)
      .lt('start_time', newBufferEndTime || newEndTime)
      .gt('end_time', newStartTime)
      .neq('status', 'cancelled')
      .neq('id', id);

    if (conflicting?.length) {
      for (const c of conflicting as any[]) {
        const svc = c.service as any;
        const cli = c.client as any;
        const occBlock = {
          stylist_id: c.stylist_id as string,
          start_time: new Date(c.start_time),
          end_time: c.buffer_end_time ? new Date(c.buffer_end_time) : new Date(c.end_time),
          service: svc ?? null,
        };
        const conflict = checkSlotConflict(newStylistId, new Date(newStartTime), new Date(newEndTime!), [occBlock]);

        if (conflict.severity === 'hard') {
          return Response.json({
            error: `Conflitto con appuntamento di ${cli?.first_name || 'cliente'} (${conflict.overlapPhase === 'application' ? 'fase attiva' : conflict.overlapPhase === 'buffer' ? 'buffer time' : 'finitura'})`,
            conflict: { severity: 'hard', appointmentId: c.id, overlapPhase: conflict.overlapPhase, stylistName: cli?.first_name },
          }, { status: 409 });
        }
        if (conflict.severity === 'soft') {
          warnings.push({
            type: 'soft_conflict',
            message: `Sovrapposizione con fase di posa`,
            appointmentId: c.id,
            clientName: cli?.first_name,
            overlapPhase: conflict.overlapPhase,
          });
        }
      }
    }
  }

  // Cleanup empty strings
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    clean[k] = v === '' ? null : v;
  }

  // Always include recalculated times
  if (newEndTime) clean.end_time = newEndTime;
  if (newBufferEndTime) clean.buffer_end_time = newBufferEndTime;

  const { data, error } = await supabase
    .from('appointments')
    .update(clean)
    .eq('id', id)
    .select('*, client:clients(*), stylist:users(*), service:services(*)')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Determine event type
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

  return Response.json({ ...data, warnings: warnings.length > 0 ? warnings : undefined });
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
