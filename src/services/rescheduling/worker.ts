import { createAdminClient } from '@/lib/supabase/admin';
import { createEmailProvider, emailConfigFromEnv } from '@/services/notifications';
import { rescheduledEmail } from '@/services/notifications/templates';
import { updateGHLAppointment } from '@/services/ghl-sync/sync';
import { pushUpdateToTreatwell } from '@/services/treatwell-sync/sync';
import { sendN8nEvent } from '@/lib/sync-webhook';
import { makeCancelToken } from '@/services/cancellation/token';
import { rescheduleLink } from './token';
let running = false;
export async function runRescheduleBatch(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = createAdminClient();
    for (let i = 0; i < 5; i++) {
      const { data, error } = await db.rpc('claim_appointment_reschedule');
      if (error) throw new Error('Reschedule queue unavailable');
      const job = data?.[0];
      if (!job) break;
      const checkpoint = async (values: Record<string, unknown>) => {
        const { data: updated, error: updateError } = await db.from('appointment_reschedules').update({ ...values, lease_until: null, lease_token: null })
          .eq('id', job.id).eq('state', 'running').eq('lease_token', job.lease_token).gt('lease_until', new Date().toISOString()).select('id');
        if (updateError || updated?.length !== 1) throw new Error('Reschedule lease lost');
      };
      let emailId: string | undefined;
      try {
        const { data: a, error: readError } = await db.from('appointments').select('start_time,status,reschedule_version').eq('id', job.appointment_id).single();
        if (readError || !a) throw new Error('Rescheduled appointment unavailable');
        if (a.status !== 'confirmed' || a.reschedule_version !== job.revision || Date.parse(a.start_time) !== Date.parse(job.new_start)) {
          await checkpoint({ state: 'done', last_error_code: 'SUPERSEDED' }); continue;
        }
        const d = job.payload;
        sendN8nEvent('appointment.moved', { id: job.appointment_id, salon_id: job.salon_id, event_id: job.id, changes: { start_time: job.new_start, end_time: job.new_end } });
        if (d.ghlId) await updateGHLAppointment(d.ghlId, job.salon_id, job.appointment_id, { startTime: job.new_start, endTime: job.new_end, title: d.serviceName });
        if (d.treatwellId) await pushUpdateToTreatwell(d.treatwellId, job.salon_id, job.appointment_id, { startTime: job.new_start, endTime: job.new_end, ualaStaffId: d.ualaStaffId, ualaTreatmentId: d.ualaTreatmentId });
        if (d.email) {
          const config = emailConfigFromEnv();
          if (!config.apiKey) throw new Error('Reschedule email unavailable');
          const base = process.env.NEXT_PUBLIC_APP_URL;
          if (!base || !process.env.CRON_SECRET) throw new Error('Reschedule links unavailable');
          const date = new Date(job.new_start);
          const message = rescheduledEmail({ clientName: d.clientName ?? 'Cliente', serviceName: d.serviceName ?? 'Servizio', salonName: d.salonName ?? 'Il salone',
            dateText: new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'full' }).format(date),
            timeText: new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', timeStyle: 'short' }).format(date),
            cancelUrl: `${base}/prenotazione/annulla?token=${makeCancelToken(job.appointment_id, process.env.CRON_SECRET)}`,
            rescheduleUrl: rescheduleLink(base, job.appointment_id, process.env.CRON_SECRET) });
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const sent = await Promise.race([createEmailProvider(config).send({ ...message, to: d.email, idempotencyKey: 'appointment-reschedule/' + job.id }),
              new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Reschedule email timeout')), 30000); })]);
            emailId = sent.id;
          } finally { if (timer) clearTimeout(timer); }
        }
      } catch {
        await checkpoint({ state: job.attempts >= 5 ? 'failed' : 'pending', last_error_code: 'RESCHEDULE_NOTIFICATION_UNAVAILABLE', available_at: new Date(Date.now() + 30000 * 2 ** Math.min(job.attempts, 6)).toISOString() });
        continue;
      }
      // If this checkpoint fails after acceptance, the same persistent key is reused.
      await checkpoint({ state: 'done', provider_email_id: emailId ?? null, last_error_code: null });
    }
  } finally { running = false; }
}
export function startRescheduleCron(): void {
  const tick = () => { void runRescheduleBatch().catch(() => console.error('[reschedule] Persistent queue unavailable')); };
  setTimeout(tick, 10000); setInterval(tick, 30000);
}
