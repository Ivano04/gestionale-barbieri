import { appointmentOccupiedEnd } from '@/lib/appointment-time';
import { appointmentServiceName } from '@/lib/booking-services';
import type { AddedService } from '@/lib/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAvailableSlots } from '@/services/booking-engine';
import { cancellationWindowHours } from '@/services/cancellation/logic';
import { canReschedule, romeSlot } from './logic';
export async function loadReschedulableAppointment(id: string) {
  const db = createAdminClient();
  const { data, error } = await db.from('appointments').select('id,salon_id,added_services,booked_services,service_id,stylist_id,status,start_time,end_time,buffer_end_time,client_cancellation_deadline_at,service:services(name),salon:salons(name),stylist:users(full_name)').eq('id', id).maybeSingle();
  if (error) throw new Error('Impossibile leggere la prenotazione');
  if (!data) return null;
  const single = <T>(value: T | T[] | null) => Array.isArray(value) ? value[0] : value ?? undefined;
  return { ...data, service: { name: appointmentServiceName({ ...data, service: single(data.service) }) }, salon: single(data.salon), stylist: single(data.stylist) };
}
export type RescheduleAppointment = NonNullable<Awaited<ReturnType<typeof loadReschedulableAppointment>>>;
export async function rescheduleSlots(a: RescheduleAppointment, date: string) {
  if (!canReschedule(a.status, a.start_time) || !a.service_id || !a.stylist_id) return [];
  const duration = Math.ceil((appointmentOccupiedEnd(a).getTime() - new Date(a.start_time).getTime()) / 60000);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const slots = await getAvailableSlots({ salon_id: a.salon_id, service_id: a.service_id, service_ids: [...new Set([a.service_id, ...(a.added_services as AddedService[] ?? []).map(s => s.service_id)])], stylist_id: a.stylist_id, date,
    exclude_appointment_id: a.id, duration_minutes: duration });
  const unique = [...new Map(slots.map(slot => [slot.time, slot])).values()];
  return unique.filter(s => new Date(romeSlot(date, s.time)).getTime() > Date.now() && romeSlot(date, s.time) !== new Date(a.start_time).toISOString());
}
export async function moveClientAppointment(a: RescheduleAppointment, input: { date: string; time: string; requestId: string; expectedStart: string }) {
  const db = createAdminClient();
  const start = romeSlot(input.date, input.time);
  // A retry of the same committed request must not fail because its slot is now occupied.
  const { data: prior, error: priorError } = await db.from('appointment_reschedules').select('appointment_id,new_start').eq('id', input.requestId).maybeSingle();
  if (priorError) throw new Error('Impossibile verificare la modifica');
  if (prior && (prior.appointment_id !== a.id || new Date(prior.new_start).getTime() !== new Date(start).getTime())) return { ok: false, reason: 'invalid_request' };
  if (!prior) {
    if (!canReschedule(a.status, a.start_time)) return { ok: false, reason: 'closed' };
    if (new Date(a.start_time).getTime() !== new Date(input.expectedStart).getTime()) return { ok: false, reason: 'stale' };
    const slots = await rescheduleSlots(a, input.date);
    if (!slots.some(s => s.time === input.time)) return { ok: false, reason: 'conflict' };
  }
  const { data, error } = await db.rpc('reschedule_client_appointment', { p_id: a.id, p_expected_start: input.expectedStart,
    p_new_start: start, p_request_id: input.requestId, p_window_hours: cancellationWindowHours() });
  if (error?.code === '23P01' || error?.code === '40P01') return { ok: false, reason: 'conflict' };
  if (error) throw new Error('Impossibile spostare la prenotazione');
  return data as { ok: boolean; reason?: string; startTime?: string; alreadyApplied?: boolean };
}
