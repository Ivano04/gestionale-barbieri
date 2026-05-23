import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes } from 'date-fns';
import { sendN8nEvent } from '@/lib/sync-webhook';
import { fetchServiceWithPhases } from '@/services/booking-engine/queries';
import { computePhaseBreakdown } from '@/services/booking-engine/phase-calculator';
import { checkSlotConflict } from '@/services/booking-engine/overlap';
import type { AddedService } from '@/lib/types';

/**
 * POST /api/appointments/[id]/add-service
 *
 * In-chair upselling: add a service to an ongoing appointment.
 * Duration logic uses precedence — the new service starts from the end
 * of the current appointment, avoiding simple arithmetic summation
 * that would create unrealistic gaps.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const adminSupabase = createAdminClient();
  const { service_id: newServiceId } = await request.json();

  if (!newServiceId) {
    return Response.json({ error: 'service_id richiesto' }, { status: 400 });
  }

  // Fetch current appointment
  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, salon_id, stylist_id, start_time, end_time, buffer_end_time, added_services, service:services(name)')
    .eq('id', id)
    .single();

  if (!appointment) {
    return Response.json({ error: 'Appuntamento non trovato' }, { status: 404 });
  }

  // Fetch the new service with phases
  const service = await fetchServiceWithPhases(newServiceId);
  if (!service) return Response.json({ error: 'Servizio non trovato' }, { status: 404 });

  const phases = computePhaseBreakdown(service);

  // Precedence logic: new service starts from current end_time (client-visible),
  // not from now — this avoids gaps. For buffer, new service's active phases
  // extend from current buffer_end_time (stylist is still cleaning).
  const currentBufferEnd = appointment.buffer_end_time || appointment.end_time;
  const startBase = new Date(currentBufferEnd);

  const newClientEnd = addMinutes(startBase, phases.totalClientVisible);
  const newBufferEnd = addMinutes(startBase, phases.totalInternal);

  // Check for conflicts with other appointments in the extended window
  if (appointment.stylist_id) {
    const { data: conflicts } = await supabase
      .from('appointments')
      .select('id, start_time, end_time, buffer_end_time, client:clients(first_name), service:services(duration_minutes, duration_application, duration_processing, duration_finishing, buffer_time_minutes)')
      .eq('stylist_id', appointment.stylist_id)
      .eq('salon_id', appointment.salon_id)
      .lt('start_time', newBufferEnd.toISOString())
      .gt('end_time', appointment.end_time) // Only check after current appt ends
      .neq('status', 'cancelled')
      .neq('id', id);

    if (conflicts?.length) {
      for (const c of conflicts as any[]) {
        const svc = c.service as any;
        const cli = c.client as any;
        const occBlock = {
          stylist_id: appointment.stylist_id,
          start_time: new Date(c.start_time),
          end_time: c.buffer_end_time ? new Date(c.buffer_end_time) : new Date(c.end_time),
          service: svc ?? null,
        };
        const conflict = checkSlotConflict(
          appointment.stylist_id!,
          startBase,
          newClientEnd,
          [occBlock],
        );

        if (conflict.severity === 'hard') {
          return Response.json({
            error: `Conflitto con appuntamento successivo di ${cli?.first_name || 'cliente'}`,
            conflict: { severity: 'hard', appointmentId: c.id },
          }, { status: 409 });
        }
      }
    }
  }

  // Build added_services array
  const existingAdded: AddedService[] = Array.isArray(appointment.added_services)
    ? appointment.added_services
    : [];

  const newAddedService: AddedService = {
    service_id: newServiceId,
    name: service.duration_minutes ? `Servizio ${newServiceId.slice(0, 8)}` : 'Servizio aggiunto',
    duration_added: phases.totalClientVisible,
    added_at: new Date().toISOString(),
  };

  // Also fetch the service name for the record
  const { data: serviceInfo } = await supabase
    .from('services')
    .select('name')
    .eq('id', newServiceId)
    .single();
  if (serviceInfo) newAddedService.name = serviceInfo.name;

  const updatedAdded = [...existingAdded, newAddedService];

  // Update appointment with new end times and added services
  const { data: updated, error } = await supabase
    .from('appointments')
    .update({
      end_time: newClientEnd.toISOString(),
      buffer_end_time: newBufferEnd.toISOString(),
      added_services: updatedAdded,
    })
    .eq('id', id)
    .select('*, client:clients(*), stylist:users(*), service:services(*)')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Fire sync webhook — block external slots immediately
  sendN8nEvent('appointment.service_added', {
    id: updated.id,
    salon_id: updated.salon_id,
    stylist_id: updated.stylist_id,
    added_service: newAddedService,
    new_end_time: updated.end_time,
    new_buffer_end_time: updated.buffer_end_time,
    ghl_appointment_id: updated.ghl_appointment_id,
    treatwell_appointment_id: updated.treatwell_appointment_id,
  });

  return Response.json(updated);
}
