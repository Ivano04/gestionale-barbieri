import { createAdminClient } from '@/lib/supabase/admin';
import { createEmailProvider, emailConfigFromEnv } from '..';
import { dailyEmail, type DailyEmailConfig } from './messages';
import { dailyRepo, type DailyRepo } from './repo';
import type { DailyPayload } from './types';
export interface DailySender { send(payload: DailyPayload, key: string): Promise<string> }
export async function runDailyOnce(repo: DailyRepo, sender: DailySender, config: DailyEmailConfig) {
  const claimed = await repo.claim();
  if (!claimed) return 'idle';
  const job = await repo.prepare(claimed);
  if (!job) return 'processed';
  let payload: DailyPayload;
  try { payload = job.payload ?? dailyEmail(job.type, job.context, config); }
  catch { await repo.block(job); return 'processed'; }
  if (!await repo.authorize(job, payload) || !await repo.current(job)) return 'processed';
  let providerId: string;
  try {
    providerId = await sender.send(payload, `daily/${job.type}/${job.id}`);
    if (!providerId) throw new Error('Missing acceptance');
  } catch { await repo.finish(job, null); return 'processed'; }
  // Acceptance is checkpointed separately: a DB failure must retain the lease,
  // payload and key so a retry cannot create a second message.
  await repo.finish(job, providerId);
  return 'processed';
}
let running = false;
export async function runDailyNotificationBatch() {
  if (running || process.env.DAILY_EMAIL_ENABLED === 'false' || (process.env.DAILY_EMAIL_MODE ?? 'test') !== 'test') return;
  const config = emailConfigFromEnv();
  if (!config.apiKey) return;
  running = true;
  try {
    const db = createAdminClient();
    const testEmail = process.env.DAILY_EMAIL_TEST_TO ?? process.env.FISKALY_TEST_EMAIL_TO ?? '';
    const { error } = await db.rpc('refresh_daily_notifications', { p_test_email: testEmail });
    if (error) throw new Error('Daily notification schedule unavailable');
    const repo = dailyRepo(db, testEmail);
    const sender: DailySender = { async send(payload, key) {
      const { from, ...message } = payload;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          createEmailProvider({ ...config, from }).send({ ...message, idempotencyKey: key }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Daily email timeout')), 20000); }),
        ]);
        return result.id;
      } finally { if (timer) clearTimeout(timer); }
    } };
    const emailConfig = { from: config.from || 'onboarding@resend.dev', baseUrl: process.env.NEXT_PUBLIC_APP_URL, secret: process.env.CRON_SECRET, reviewUrl: process.env.REVIEW_URL };
    for (let i = 0; i < 20; i++) if (await runDailyOnce(repo, sender, emailConfig) === 'idle') break;
  } finally { running = false; }
}
export function startDailyNotificationCron() {
  if (!process.env.RESEND_API_KEY) return;
  const tick = () => { void runDailyNotificationBatch().catch(() => console.error('[daily-notifications] Queue unavailable')); };
  setTimeout(tick, 45000);
  setInterval(tick, 60000);
}
