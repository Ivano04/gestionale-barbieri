import { parseISO } from 'date-fns';

/** Format an ISO string as HH:mm in the local (browser) timezone */
export function toLocalTimeString(iso: string): string {
  const d = parseISO(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** Build a full ISO string from a date string and a HH:mm time, using the local timezone offset */
export function buildSlotTime(dateStr: string, time: string): string {
  const slotDate = new Date(`${dateStr}T${time}:00`);
  const offsetMin = -slotDate.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
  const mm = String(absMin % 60).padStart(2, '0');
  return `${dateStr}T${time}:00${sign}${hh}:${mm}`;
}

/** Check whether a slot identified by date + time is in the past */
export function isPastSlot(dateStr: string, time: string): boolean {
  const slot = new Date(`${dateStr}T${time}:00`);
  return slot < new Date();
}

/**
 * Get the IANA timezone offset (e.g. "+02:00") for Europe/Rome on a given date.
 * Safe for server-side use regardless of Node.js TZ setting.
 */
export function getRomeOffset(dateStr: string): string {
  const utcDate = new Date(`${dateStr}T12:00:00+00:00`);
  const romeHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Rome',
      hour: 'numeric',
      hour12: false,
    }).format(utcDate)
  );
  let offsetHours = romeHour - 12;
  if (offsetHours > 12) offsetHours -= 24;
  if (offsetHours < -12) offsetHours += 24;
  const sign = offsetHours >= 0 ? '+' : '-';
  const hh = String(Math.abs(offsetHours)).padStart(2, '0');
  return `${sign}${hh}:00`;
}

/** Get today's date string in yyyy-MM-dd format (local timezone) */
export function todayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
