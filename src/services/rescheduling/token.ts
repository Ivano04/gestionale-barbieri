import { createHmac, timingSafeEqual } from 'node:crypto';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function makeRescheduleToken(id: string, secret: string): string {
  if (!secret || !UUID.test(id)) throw new Error('Reschedule link configuration unavailable');
  return id + '.' + createHmac('sha256', secret).update('reschedule:v1:' + id).digest('hex');
}
export function verifyRescheduleToken(token: unknown, secret: string): string | null {
  if (typeof token !== 'string' || !secret || token.length !== 101) return null;
  const [id, signature] = token.split('.');
  if (!UUID.test(id) || !/^[0-9a-f]{64}$/.test(signature ?? '')) return null;
  const expected = makeRescheduleToken(id, secret).split('.')[1];
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null;
}
export function rescheduleLink(base: string, id: string, secret: string): string {
  return `${base}/prenotazione/modifica?token=${makeRescheduleToken(id, secret)}`;
}
