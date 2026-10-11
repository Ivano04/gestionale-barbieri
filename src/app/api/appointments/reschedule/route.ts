import type { NextRequest } from 'next/server';
import { verifyRescheduleToken } from '@/services/rescheduling/token';
import { canReschedule, validDate } from '@/services/rescheduling/logic';
import { loadReschedulableAppointment, moveClientAppointment, rescheduleSlots } from '@/services/rescheduling/service';
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request: NextRequest) {
  const id = verifyRescheduleToken(request.nextUrl.searchParams.get('token'), process.env.CRON_SECRET ?? '');
  if (!id) return response({ error: 'Link non valido' }, 400);
  try {
    const a = await loadReschedulableAppointment(id);
    if (!a) return response({ error: 'Prenotazione non trovata' }, 404);
    const date = request.nextUrl.searchParams.get('date');
    if (date && !validDate(date)) return response({ error: 'Data non valida' }, 400);
    const open = canReschedule(a.status, a.start_time) && !!a.stylist_id && !!a.service_id;
    return response({ serviceName: a.service?.name ?? 'Servizio', salonName: a.salon?.name ?? 'Il salone', stylistName: a.stylist?.full_name ?? 'Operatore',
      startTime: a.start_time, canModify: open, cancellationDeadline: a.client_cancellation_deadline_at,
      slots: date && open ? await rescheduleSlots(a, date) : [] });
  } catch { return response({ error: 'Servizio temporaneamente non disponibile. Riprova.' }, 503); }
}
export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return response({ error: 'Richiesta non valida' }, 400); }
  if (!body || typeof body !== 'object') return response({ error: 'Richiesta non valida' }, 400);
  const input = body as Record<string, unknown>;
  const id = verifyRescheduleToken(input.token, process.env.CRON_SECRET ?? '');
  if (!id) return response({ error: 'Link non valido' }, 400);
  if (typeof input.date !== 'string' || !validDate(input.date) || typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
    || typeof input.requestId !== 'string' || !UUID.test(input.requestId) || typeof input.expectedStart !== 'string' || !Number.isFinite(Date.parse(input.expectedStart))) return response({ error: 'Data o ora non valida' }, 400);
  try {
    const a = await loadReschedulableAppointment(id);
    if (!a) return response({ error: 'Prenotazione non trovata' }, 404);
    const result = await moveClientAppointment(a, { date: input.date, time: input.time, requestId: input.requestId, expectedStart: input.expectedStart });
    if (!result.ok) return response({ error: ['stale','conflict'].includes(result.reason ?? '') ? 'Lo slot o la prenotazione sono cambiati. Ricarica gli orari e riprova.' : 'Questa prenotazione non puo essere modificata. Contatta il salone.' }, 409);
    return response(result);
  } catch { return response({ error: 'Non e stato possibile confermare lo spostamento. Riprova con la stessa selezione.' }, 503); }
}
