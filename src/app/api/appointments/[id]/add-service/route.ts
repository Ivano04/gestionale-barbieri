import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes } from 'date-fns';
import { sendN8nEvent } from '@/lib/sync-webhook';
import { fetchServiceDuration } from '@/services/booking-engine/queries';
import type { AddedService } from '@/lib/types';

/**
 * POST /api/appointments/[id]/add-service
 *
 * In-chair upselling: add a service to an ongoing appointment.
 * New service starts from buffer_end_time, avoiding gaps.
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

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, salon_id, stylist_id, start_time, end_time, buffer_end_time, added_services')
    .eq('id', id)
    .single();

  if (!appointment) {
    return Response.json({ error: 'Appuntamento non trovato' }, { status: 404 });
  }

  const duration = await fetchServiceDuration(newServiceId);
  if (!duration) return Response.json({ error: 'Servizio non trovato' }, { status: 404 });

  // New service starts from current buffer_end_time (stylist free after cleanup)
  const currentBufferEnd = appointment.buffer_end_time || appointment.end_time;
  const startBase = new Date(currentBufferEnd);
  const newClientEnd = addMinutes(startBase, duration);
  const newBufferEnd = addMinutes(startBase, duration);

  // Check conflicts in the extended window
  if (appointment.stylist_id) {
    const { data: conflicts } = await supabase
      .from('appointments')
      .select('id, client:clients(first_name)')
      .eq('stylist_id', appointment.stylist_id)
      .eq('salon_id', appointment.salon_id)
      .lt('start_time', newBufferEnd.toISOString())
      .gt('end_time', appointment.end_time)
      .neq('status', 'cancelled')
      .neq('id', id);

    if (conflicts?.length) {
      const cli = conflicts[0].client as any;
      return Response.json({
        error: `Conflitto con appuntamento successivo di ${cli?.first_name || 'cliente'}`,
      }, { status: 409 });
    }
  }

  const existingAdded: AddedService[] = Array.isArray(appointment.added_services)
    ? appointment.added_services : [];

  const { data: serviceInfo } = await supabase
    .from('services').select('name').eq('id', newServiceId).single();

  const newAddedService: AddedService = {
    service_id: newServiceId,
    name: serviceInfo?.name || 'Servizio aggiunto',
    duration_added: duration,
    added_at: new Date().toISOString(),
  };

  const { data: updated, error } = await supabase
    .from('appointments')
    .update({
      end_time: newClientEnd.toISOString(),
      buffer_end_time: newBufferEnd.toISOString(),
      added_services: [...existingAdded, newAddedService],
    })
    .eq('id', id)
    .select('*, client:clients(*), stylist:users(*), service:services(*)')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

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
