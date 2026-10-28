import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyJob, DailyPayload } from './types';
export interface DailyRepo {
  claim(): Promise<DailyJob | null>;
  prepare(job: DailyJob): Promise<DailyJob | null>;
  authorize(job: DailyJob, payload: DailyPayload): Promise<boolean>;
  current(job: DailyJob): Promise<boolean>;
  finish(job: DailyJob, providerId: string | null): Promise<void>;
  block(job: DailyJob): Promise<void>;
}
export function dailyRepo(db: SupabaseClient, testEmail: string): DailyRepo {
  async function rpc(name: string, args?: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error('Daily notification database unavailable');
    return data;
  }
  const lease = (job: DailyJob) => ({ p_id: job.id, p_lease: job.lease_token });
  return {
    async claim() { return (await rpc('claim_daily_email'))?.[0] ?? null; },
    async prepare(job) { return (await rpc('prepare_daily_email', { ...lease(job), p_test_email: testEmail }))?.[0] ?? null; },
    async authorize(job, payload) { return await rpc('authorize_daily_email', { ...lease(job), p_context: job.context, p_payload: payload }) === true; },
    async current(job) { return await rpc('daily_email_current', lease(job)) === true; },
    async finish(job, providerId) {
      if (!await rpc('finish_daily_email', { ...lease(job), p_provider_id: providerId })) throw new Error('Daily notification checkpoint failed');
    },
    async block(job) {
      const { error } = await db.from('daily_notifications').update({ state: 'blocked', last_error_code: 'EMAIL_CONFIGURATION', lease_until: null, lease_token: null })
        .eq('id', job.id).eq('state', 'running').eq('lease_token', job.lease_token).is('first_attempt_at', null);
      if (error) throw new Error('Daily notification configuration checkpoint failed');
    },
  };
}
