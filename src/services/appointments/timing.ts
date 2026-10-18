type ExistingTiming = {
  start_time: string;
  end_time: string;
  buffer_end_time: string | null;
  service_id: string | null;
};
type ServiceTiming = { duration_minutes: number; buffer_time_minutes: number | null };

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('Data o orario non valido');
  }
  return Date.parse(value);
}

/** A calendar move preserves the booked duration and shifts its buffer as well. */
export function resolveAppointmentTiming(existing: ExistingTiming, changes: Record<string, unknown>, service?: ServiceTiming) {
  const oldStart = timestamp(existing.start_time);
  const oldEnd = timestamp(existing.end_time);
  const oldBuffer = existing.buffer_end_time ? timestamp(existing.buffer_end_time) : oldEnd;
  const start = changes.start_time === undefined ? oldStart : timestamp(changes.start_time);
  const serviceChanged = changes.service_id !== undefined && changes.service_id !== existing.service_id;
  const suppliedEnd = changes.end_time === undefined ? oldEnd : timestamp(changes.end_time);
  // Expanded appointment forms include the old end: that value is not a resize.
  const explicitEnd = changes.end_time !== undefined && suppliedEnd !== oldEnd;
  if (serviceChanged && (!service || service.duration_minutes <= 0)) throw new Error('Servizio non valido');
  const end = explicitEnd ? suppliedEnd : serviceChanged ? start + service!.duration_minutes * 60000 : start + (oldEnd - oldStart);
  const suppliedBuffer = changes.buffer_end_time === undefined || changes.buffer_end_time === null ? oldBuffer : timestamp(changes.buffer_end_time);
  const explicitBuffer = changes.buffer_end_time != null && suppliedBuffer !== oldBuffer;
  const bufferDuration = serviceChanged ? Math.max(0, service!.buffer_time_minutes ?? 0) * 60000 : Math.max(0, oldBuffer - oldEnd);
  const buffer = explicitBuffer ? suppliedBuffer : end + bufferDuration;
  if (end <= start) throw new Error('La fine deve essere successiva all’inizio dell’appuntamento');
  if (buffer < end) throw new Error('Il buffer deve terminare dopo la fine dell’appuntamento');
  return { start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), buffer_end_time: new Date(buffer).toISOString() };
}
