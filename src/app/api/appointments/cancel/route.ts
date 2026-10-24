import { rescheduleLink } from '@/services/rescheduling/token';
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
    .select('salon_id, start_time, client_cancellation_deadline_at, status, service:services(name), salon:salons(name)')
    .eq('id', appointmentId)
    .maybeSingle();
  if (!appt) return Response.json({ error: 'Prenotazione non trovata' }, { status: 404 });

  const { data: pay } = await admin
    .from('payments')
    .select('amount_cents')
    .eq('appointment_id', appointmentId)
    .eq('status', 'succeeded')
    .maybeSingle();

  const { data: salonSale, error: saleError } = await admin.from('salon_sales').select('amount_cents').eq('appointment_id', appointmentId).eq('salon_id', appt.salon_id).maybeSingle();
  if (saleError) return Response.json({ error: 'Impossibile verificare il pagamento' }, { status: 503 });
  const refundEligible = !salonSale && isRefundEligible(appt.start_time, new Date(), cancellationWindowHours(), appt.client_cancellation_deadline_at);

  return Response.json({
    serviceName: (appt as any).service?.name || 'Servizio',
    salonName: (appt as any).salon?.name || 'Il salone',
    dateText: fmtDate(appt.start_time),
    timeText: fmtTime(appt.start_time),
    rescheduleUrl: process.env.CRON_SECRET ? rescheduleLink(process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin, appointmentId, process.env.CRON_SECRET) : undefined,
    alreadyCancelled: appt.status === 'cancelled',
    refundEligible,
    manualReview: !!salonSale,
    amountCents: pay?.amount_cents ?? salonSale?.amount_cents ?? null,
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
  if (!result.ok) return Response.json({ error: result.reason === 'attendance_closed' ? 'Questa visita è già terminata. Per correggere la presenza contatta il salone.' : 'Prenotazione non trovata' }, { status: result.reason === 'attendance_closed' ? 409 : 404 });

  return Response.json({ ok: true, refunded: result.refunded, refundPending: !!result.refundPending, refundStatus: result.refundStatus, alreadyCancelled: !!result.alreadyCancelled });
}
