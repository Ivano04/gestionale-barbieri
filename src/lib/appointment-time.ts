/** Cleanup can extend a service, but an old imported buffer must never shorten it. */
export function appointmentOccupiedEnd(a: { end_time: string; buffer_end_time?: string | null }): Date {
  const end = new Date(a.end_time);
  const buffer = a.buffer_end_time ? new Date(a.buffer_end_time) : end;
  return buffer > end ? buffer : end;
}
