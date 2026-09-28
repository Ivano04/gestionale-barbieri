/** Avvia i cron di sincronizzazione al boot del server Next.js */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startTreatwellCron } = await import('@/services/treatwell-sync/cron');
    startTreatwellCron();
    console.log('[cron] Treatwell sync avviato (ogni 15 min)');

    const { startNotificationsCron } = await import('@/services/notifications/cron');
    startNotificationsCron();
    if (process.env.RESEND_API_KEY) {
      console.log('[cron] Notifiche email avviate (ogni 15 min)');
    }
  }
}
