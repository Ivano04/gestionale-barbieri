import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyCancelToken } from '@/services/cancellation/token';
import { isRefundEligible, cancellationWindowHours } from '@/services/cancellation/logic';
import { cancelAndMaybeRefund } from '@/services/cancellation/service';

function secret(): string {
  return process.env.CRON_SECRET || '';
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}
function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

// GET /api/appointments/cancel?token=...  → dettagli per la pagina di annullo
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const appointmentId = verifyCancelToken(token, secret());
  if (!appointmentId) return Response.json({ error: 'Link non valido' }, { status: 400 });

  const admin = createAdminClient();
  const { data: appt } = await admin
    .from('appointments')
    .select('start_time, status, service:services(name), salon:salons(name)')
    .eq('id', appointmentId)
    .maybeSingle();
  if (!appt) return Response.json({ error: 'Prenotazione non trovata' }, { status: 404 });

  const { data: pay } = await admin
    .from('payments')
    .select('amount_cents')
    .eq('appointment_id', appointmentId)
    .eq('status', 'succeeded')
    .maybeSingle();

  const refundEligible = isRefundEligible(appt.start_time, new Date(), cancellationWindowHours());

  return Response.json({
    serviceName: (appt as any).service?.name || 'Servizio',
    salonName: (appt as any).salon?.name || 'Il salone',
    dateText: fmtDate(appt.start_time),
    timeText: fmtTime(appt.start_time),
    alreadyCancelled: appt.status === 'cancelled',
    refundEligible,
    amountCents: pay?.amount_cents ?? null,
  });
}

// POST /api/appointments/cancel  { token }  → esegue l'annullo (+ rimborso se in tempo)
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body non valido' }, { status: 400 });
  }
  const appointmentId = verifyCancelToken(body?.token || '', secret());
  if (!appointmentId) return Response.json({ error: 'Link non valido' }, { status: 400 });

  const result = await cancelAndMaybeRefund(appointmentId, 'client');
  if (!result.ok) return Response.json({ error: 'Prenotazione non trovata' }, { status: 404 });

  return Response.json({ ok: true, refunded: result.refunded, alreadyCancelled: !!result.alreadyCancelled });
}
