import { createAdminClient } from '@/lib/supabase/admin';
import { emailConfigFromEnv, createEmailProvider } from './index';
import { createSupabaseNotificationsRepo } from './repo';
import { sendBookingEmail } from './service';
import { selectDueNotifications, REMINDER_LEAD_MS, REVIEW_WINDOW_MS } from './cron-logic';

let running = false;

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}
function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

async function runNotifications() {
  if (running) return;
  running = true;
  try {
    const cfg = emailConfigFromEnv();
    if (!cfg.apiKey) return; // Resend non configurato: niente da fare

    const supabase = createAdminClient();
    const now = new Date();
    // Finestra ampia; il filtro preciso lo fa selectDueNotifications.
    const from = new Date(now.getTime() - REVIEW_WINDOW_MS - 2 * 60 * 60_000).toISOString();
    const to = new Date(now.getTime() + REMINDER_LEAD_MS + 5 * 60_000).toISOString();

    const { data: appts } = await supabase
      .from('appointments')
      .select('id, start_time, end_time, status, salon_id, client:clients(first_name,email), service:services(name), salon:salons(name)')
      .gte('start_time', from)
      .lte('start_time', to)
      .neq('status', 'cancelled');

    if (!appts?.length) return;

    const due = selectDueNotifications(appts as any, now);
    if (!due.length) return;

    const provider = createEmailProvider(cfg);
    const repo = createSupabaseNotificationsRepo(supabase);
    const byId = new Map((appts as any[]).map((a) => [a.id, a]));
    const reviewUrl = process.env.REVIEW_URL;

    for (const d of due) {
      const a: any = byId.get(d.appointmentId);
      const clientEmail = a?.client?.email;
      if (!clientEmail) continue;
      await sendBookingEmail({
        provider,
        repo,
        type: d.type,
        data: {
          salonId: a.salon_id,
          appointmentId: a.id,
          to: clientEmail,
          clientName: a.client?.first_name || 'Cliente',
          serviceName: a.service?.name || 'Servizio',
          dateText: fmtDate(a.start_time),
          timeText: fmtTime(a.start_time),
          salonName: a.salon?.name || 'Il salone',
          reviewUrl: d.type === 'review' ? reviewUrl : undefined,
        },
      }).catch((err) => console.error('[notif-cron] invio fallito', d, err?.message));
    }
  } catch (e: any) {
    console.error('[notif-cron] errore:', e.message);
  } finally {
    running = false;
  }
}

/** Avvia il cron delle notifiche (chiamato una volta al boot). No-op senza RESEND_API_KEY. */
export function startNotificationsCron() {
  if (!process.env.RESEND_API_KEY) return;
  setTimeout(runNotifications, 45_000);
  setInterval(runNotifications, 15 * 60 * 1000);
}
