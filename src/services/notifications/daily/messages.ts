import { makeCancelToken } from '@/services/cancellation/token';
import { rescheduleLink } from '@/services/rescheduling/token';
import type { DailyContext, DailyPayload, DailyType } from './types';
export interface DailyEmailConfig { from: string; baseUrl?: string; secret?: string; reviewUrl?: string }
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const time = (value: string) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', timeStyle: 'short' }).format(new Date(value));
function url(value: string): string {
  const parsed = new URL(value);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Invalid email URL');
  return parsed.toString();
}
export function dailyEmail(type: DailyType, context: DailyContext, config: DailyEmailConfig): DailyPayload {
  if (!context.email || !context.appointments.length) throw new Error('Missing visit details');
  const day = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'full' }).format(new Date(context.visitDate + 'T12:00:00Z'));
  let subject: string, body: string, text: string;
  if (type === 'reminder') {
    if (!config.baseUrl || !config.secret) throw new Error('Missing management links');
    const base = url(config.baseUrl).replace(/\/$/, '');
    const rows = context.appointments.map(a => ({
      label: `${time(a.startTime)}–${time(a.endTime)} · ${a.serviceName}${a.stylistName ? ' · ' + a.stylistName : ''}`,
      edit: rescheduleLink(base, a.id, config.secret!),
      cancel: `${base}/prenotazione/annulla?token=${makeCancelToken(a.id, config.secret!)}`,
    }));
    subject = `Promemoria della tua visita — ${day}`;
    body = `<p>Ecco gli appuntamenti del ${escape(day)}:</p><ul style="padding-left:20px">${rows.map(r => `<li style="margin:18px 0"><strong>${escape(r.label)}</strong><br><a href="${escape(r.edit)}">Modifica data e ora</a> · <a href="${escape(r.cancel)}">Annulla questa prenotazione</a></li>`).join('')}</ul><p>Ti aspettiamo!</p>`;
    text = `Ciao ${context.clientName}, ecco gli appuntamenti del ${day} da ${context.salonName}:\n\n` + rows.map(r => `${r.label}\nModifica data e ora: ${r.edit}\nAnnulla questa prenotazione: ${r.cancel}`).join('\n\n');
  } else {
    const review = config.reviewUrl ? url(config.reviewUrl) : null;
    subject = `Com'è andata da ${context.salonName}?`;
    body = `<p>Grazie per la tua visita del ${escape(day)}! Ci farebbe piacere sapere com'è andata.</p>${review ? `<p><a href="${escape(review)}" style="display:inline-block;background:#2563eb;color:white;padding:12px 20px;border-radius:8px;text-decoration:none">Lascia una recensione</a></p>` : '<p>Rispondi a questa email per raccontarci la tua esperienza.</p>'}<p>Grazie e a presto!</p>`;
    text = `Ciao ${context.clientName}, grazie per la tua visita del ${day} da ${context.salonName}! ${review ? 'Lasciaci una recensione: ' + review : 'Rispondi a questa email per raccontarci la tua esperienza.'}`;
  }
  return { from: config.from, to: context.email, subject, text,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033;line-height:1.6"><h2>${escape(context.salonName)}</h2><p>Ciao ${escape(context.clientName)},</p>${body}</div>` };
}
