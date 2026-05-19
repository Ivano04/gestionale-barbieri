import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { addMinutes } from 'date-fns';
import { sendN8nEvent } from '@/lib/sync-webhook';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const adminSupabase = createAdminClient();
  const body = await request.json();

  // If start_time or stylist_id changed, check for conflicts
  if (body.start_time || body.stylist_id) {
    const { data: existing } = await supabase
      .from('appointments')
      .select('stylist_id, service_id, salon_id, start_time')
      .eq('id', id)
      .single();

    if (!existing) {
      return Response.json({ error: 'Appuntamento non trovato' }, { status: 404 });
    }

    const newStylistId = body.stylist_id ?? existing.stylist_id;
    const newStartTime = body.start_time ?? existing.start_time;

    let durationMinutes: number | null = null;
    const serviceId = body.service_id ?? existing.service_id;
    if (serviceId) {
      const { data: service } = await supabase
        .from('services').select('duration_minutes').eq('id', serviceId).single();
      durationMinutes = service?.duration_minutes ?? null;
    }

    if (newStartTime && durationMinutes) {
      const endTime = addMinutes(new Date(newStartTime), durationMinutes).toISOString();

      // Past booking check
      if (new Date(newStartTime) < new Date()) {
        return Response.json({ error: 'Non puoi spostare un appuntamento nel passato' }, { status: 400 });
      }

      // Time blocks check
      let blockQuery = adminSupabase
        .from('time_blocks')
        .select('id')
        .eq('salon_id', existing.salon_id)
        .lt('start_time', endTime)
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

      // Appointment conflict check (exclude self)
      const { data: conflict } = await supabase
        .from('appointments')
        .select('id')
        .eq('stylist_id', newStylistId)
        .eq('salon_id', existing.salon_id)
        .lt('start_time', endTime)
        .gt('end_time', newStartTime)
        .neq('status', 'cancelled')
        .neq('id', id)
        .limit(1);

      if (conflict?.length) {
        return Response.json({ error: 'Slot già occupato' }, { status: 409 });
      }
    }
  }

  // Cleanup: convert empty strings to null
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    clean[k] = v === '' ? null : v;
  }

  const { data, error } = await supabase
    .from('appointments')
    .update(clean)
    .eq('id', id)
    .select('*, client:clients(*), stylist:users(*), service:services(*)')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Fire-and-forget n8n webhook
  sendN8nEvent('appointment.updated', {
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
  const { error } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ status: 'ok' });
}
