import { parseISO } from 'date-fns';

/** Format an ISO string as HH:mm in the local (browser) timezone */
export function toLocalTimeString(iso: string): string {
  const d = parseISO(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** Build a full ISO string from a date string and a HH:mm time, using the local timezone offset */
export function buildSlotTime(dateStr: string, time: string): string {
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = String(Math.abs(offset)).padStart(2, '0');
  return `${dateStr}T${time}:00${sign}${abs}:00`;
}

/** Check whether a slot identified by date + time is in the past */
export function isPastSlot(dateStr: string, time: string): boolean {
  const slot = new Date(`${dateStr}T${time}:00`);
  return slot < new Date();
}

/** Get today's date string in yyyy-MM-dd format (local timezone) */
export function todayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
