import { createHmac, timingSafeEqual } from 'crypto';

// Token di annullo firmato (stateless): "<appointmentId>.<hmac>".
// Consente al cliente di annullare dal link nell'email senza autenticazione,
// senza poter annullare appuntamenti altrui (non puo' falsificare la firma).

function sign(appointmentId: string, secret: string): string {
  return createHmac('sha256', secret).update(appointmentId).digest('hex').slice(0, 32);
}

export function makeCancelToken(appointmentId: string, secret: string): string {
  return `${appointmentId}.${sign(appointmentId, secret)}`;
}

export function verifyCancelToken(token: string, secret: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const appointmentId = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(appointmentId, secret);
  if (provided.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return appointmentId;
}
