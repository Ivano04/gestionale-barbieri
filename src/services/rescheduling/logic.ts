import { getRomeOffset } from '@/lib/date-utils';
export function validDate(date: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && parsed.getTime() <= now.getTime() + 365 * 86400000;
}
export function romeSlot(date: string, time: string): string {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Data o ora non valida');
  return new Date(`${date}T${time}:00${getRomeOffset(date)}`).toISOString();
}
export function canReschedule(status: string, start: string, now = new Date()): boolean {
  return status === 'confirmed' && new Date(start).getTime() > now.getTime();
}
