import { expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { enqueueFiscalTestEmails } from '../src/services/fiscal/email-cron';
import { fiscalEmailRepo } from '../src/services/fiscal/email-repo';
import { runFiscalEmailOnce } from '../src/services/fiscal/email-worker';
it.skipIf(process.env.FISCAL_LOCAL_INTEGRATION !== 'true')('persists fiscal email jobs and recovers accepted sends without duplication', async () => {
  expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: document, error } = await db.from('fiscal_documents').select('id,salon_id,pdf_storage_path').eq('payment_id', '29effce3-2bf0-4512-8db4-5a51d898eba3').single();
  expect(error).toBeNull(); expect(document?.pdf_storage_path).toBeTruthy();
  const { data: existing, error: readError } = await db.from('fiscal_email_jobs').select('id');
  expect(readError).toBeNull(); expect(existing).toHaveLength(0);
  const config = { apiKey: 'FAKE-NOT-USED', to: 'authorized@example.invalid', from: 'onboarding@resend.dev' };
  try {
    await enqueueFiscalTestEmails(db, config); await enqueueFiscalTestEmails(db, config);
    const { data: jobs, error: jobsError } = await db.from('fiscal_email_jobs').select('*');
    expect(jobsError).toBeNull(); expect(jobs).toHaveLength(1); const job = jobs![0];
    expect(job.document_id).toBe(document!.id); expect(job.recipient).toBe(config.to);
    const { error: mutateError } = await db.from('fiscal_email_jobs').update({ recipient: 'other@example.invalid' }).eq('id', job.id);
    expect(mutateError).toBeTruthy();
    const { error: wrongSalonError } = await db.from('fiscal_email_jobs').update({ salon_id: '22222222-2222-2222-2222-222222222222' }).eq('id', job.id);
    expect(wrongSalonError).toBeTruthy();
    const repo = fiscalEmailRepo(db); const calls: string[] = []; const accepted = new Map<string, string>();
    const sender = { send: vi.fn(async (_payload, _pdf, key: string) => { calls.push(key); if (!accepted.has(key)) accepted.set(key, 'SIMULATED-email-id'); return accepted.get(key)!; }) };
    const firstRepo = { ...repo, checkpoint: async () => { throw new Error('Simulated DB outage after acceptance'); } };
    await expect(runFiscalEmailOnce(firstRepo, sender, config.to)).rejects.toThrow('Simulated DB outage');
    expect(await repo.claim()).toBeNull();
    const { error: expireError } = await db.from('fiscal_email_jobs').update({ lease_until: new Date(Date.now() - 1000).toISOString() }).eq('id', job.id);
    expect(expireError).toBeNull();
    await runFiscalEmailOnce(repo, sender, config.to);
    expect(calls).toHaveLength(2); expect(calls[0]).toBe(calls[1]); expect(accepted.size).toBe(1);
    const { data: sent } = await db.from('fiscal_email_jobs').select('state,provider_email_id,sent_at').eq('id', job.id).single();
    expect(sent?.state).toBe('sent'); expect(sent?.provider_email_id).toBe('SIMULATED-email-id'); expect(sent?.sent_at).toBeTruthy();
    expect(await repo.claim()).toBeNull();
    const { error: resetError } = await db.from('fiscal_email_jobs').update({ state: 'retry', first_attempt_at: new Date(Date.now() - 24 * 3600000).toISOString(), available_at: new Date(Date.now() - 1000).toISOString() }).eq('id', job.id);
    expect(resetError).toBeNull(); expect(await repo.claim()).toBeNull();
    const { data: expired } = await db.from('fiscal_email_jobs').select('state,last_error_code').eq('id', job.id).single();
    expect(expired?.state).toBe('uncertain'); expect(expired?.last_error_code).toBe('IDEMPOTENCY_WINDOW_EXPIRED');
  } finally {
    const { error: cleanupError } = await db.from('fiscal_email_jobs').delete().eq('document_id', document!.id);
    expect(cleanupError).toBeNull();
  }
}, 60000);
