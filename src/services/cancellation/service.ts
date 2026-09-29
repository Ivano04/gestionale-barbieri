import { createAdminClient } from '@/lib/supabase/admin';
import { sendN8nEvent } from '@/lib/sync-webhook';
import { deleteFromTreatwell } from '@/services/treatwell-sync/sync';
import { deleteGHLAppointment } from '@/services/ghl-sync/sync';
import { createPaymentProvider, paymentConfigFromEnv } from '@/services/payments';
import { createSupabasePaymentsRepo } from '@/services/payments/repo';
import { refundPayment } from '@/services/payments/refund';
import { createEmailProvider, emailConfigFromEnv } from '@/services/notifications';
import { cancellationEmail } from '@/services/notifications/templates';
import { shouldRefundOnCancel, cancellationWindowHours, type CancelInitiator } from './logic';

export interface CancelResult {
  ok: boolean;
  reason?: 'not_found';
  alreadyCancelled?: boolean;
  refunded: boolean;
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}
function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

// Annulla un appuntamento e, se dovuto dalla policy, rimborsa il pagamento.
// Usata sia dall'annullo cliente (finestra) sia dall'annullo staff (rimborso sempre).
// Idempotente: se gia' annullato, non ripete nulla.
export async function cancelAndMaybeRefund(appointmentId: string, initiatedBy: CancelInitiator): Promise<CancelResult> {
  const admin = createAdminClient();

  const { data: appt } = await admin
    .from('appointments')
    .select('id, start_time, status, salon_id, treatwell_appointment_id, ghl_appointment_id, client:clients(first_name,email), service:services(name), salon:salons(name)')
    .eq('id', appointmentId)
    .maybeSingle();

  if (!appt) return { ok: false, reason: 'not_found', refunded: false };
  if (appt.status === 'cancelled') return { ok: true, alreadyCancelled: true, refunded: false };

  const willRefund = shouldRefundOnCancel({
    startIso: appt.start_time,
    now: new Date(),
    windowHours: cancellationWindowHours(),
    initiatedBy,
  });

  // 1) soft-cancel
  await admin.from('appointments').update({ status: 'cancelled' }).eq('id', appointmentId);

  // 2) eventi + sync esterni (stesso comportamento della DELETE staff)
  sendN8nEvent('appointment.cancelled', {
    id: appointmentId,
    salon_id: appt.salon_id,
    ghl_appointment_id: appt.ghl_appointment_id,
    treatwell_appointment_id: appt.treatwell_appointment_id,
  });
  if (appt.ghl_appointment_id && appt.salon_id) {
    deleteGHLAppointment(appt.ghl_appointment_id, appt.salon_id, appointmentId).catch((e) => console.error('[ghl] delete failed:', e));
  }
  if (appt.treatwell_appointment_id && appt.salon_id) {
    deleteFromTreatwell(appt.treatwell_appointment_id, appt.salon_id, appointmentId).catch((e) => console.error('[treatwell] delete failed:', e));
  }

  // 3) rimborso se dovuto e c'e' un pagamento riuscito
  let refunded = false;
  if (willRefund) {
    const { data: pay } = await admin
      .from('payments')
      .select('provider_payment_id')
      .eq('appointment_id', appointmentId)
      .eq('status', 'succeeded')
      .maybeSingle();
    if (pay?.provider_payment_id) {
      try {
        await refundPayment({
          provider: createPaymentProvider(paymentConfigFromEnv()),
          repo: createSupabasePaymentsRepo(admin),
          providerRef: pay.provider_payment_id,
        });
        refunded = true;
      } catch (e) {
        console.error('[cancel] rimborso fallito:', e);
      }
    }
  }

  // 4) email di annullamento (best-effort, non blocca)
  try {
    const cfg = emailConfigFromEnv();
    const clientEmail = (appt as any).client?.email;
    if (cfg.apiKey && clientEmail) {
      const email = cancellationEmail({
        clientName: (appt as any).client?.first_name || 'Cliente',
        serviceName: (appt as any).service?.name || 'Servizio',
        dateText: fmtDate(appt.start_time),
        timeText: fmtTime(appt.start_time),
        salonName: (appt as any).salon?.name || 'Il salone',
        refunded,
      });
      await createEmailProvider(cfg).send({ to: clientEmail, subject: email.subject, html: email.html, text: email.text });
    }
  } catch (e) {
    console.error('[cancel] email fallita:', e);
  }

  return { ok: true, refunded };
}
