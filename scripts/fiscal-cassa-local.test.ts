import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { archiveFiscalTestPdfs, FISCAL_BUCKET } from '../src/services/fiscal/pdf-storage';

it.skipIf(process.env.FISCAL_LOCAL_INTEGRATION !== 'true')('archives TEST PDF and isolates Cassa access between salons', async () => {
  expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
  expect(process.env.FISKALY_ENV).toBe('test');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  await archiveFiscalTestPdfs(db);
  const { data: document, error } = await db.from('fiscal_documents').select('id,pdf_storage_path,salon_id')
    .eq('payment_id', '29effce3-2bf0-4512-8db4-5a51d898eba3').eq('operation', 'receipt').single();
  expect(error).toBeNull(); expect(document?.pdf_storage_path).toBeTruthy();
  const { data: pdf, error: pdfError } = await db.storage.from(FISCAL_BUCKET).download(document!.pdf_storage_path);
  expect(pdfError).toBeNull(); expect((await pdf!.text()).slice(0, 5)).toBe('%PDF-');
  const run = randomUUID(); const otherSalon = randomUUID(); const users: string[] = [];
  async function staffCookie(salonId: string) {
    const email = 'fiscal-test-' + randomUUID() + '@example.invalid';
    const password = randomUUID() + 'Aa1!';
    const { data, error: createError } = await db.auth.admin.createUser({ email, password, email_confirm: true,
      user_metadata: { salon_id: salonId, full_name: 'TEST Cassa', role: 'receptionist' } });
    expect(createError).toBeNull(); expect(data.user).toBeTruthy(); users.push(data.user!.id);
    const { error: profileError } = await db.from('users').upsert({ id: data.user!.id, email, full_name: 'TEST Cassa', role: 'receptionist', salon_id: salonId });
    expect(profileError).toBeNull();
    const cookies = new Map<string, string>();
    const client = createServerClient(url, anon, { cookies: { getAll: () => [], setAll: values => { for (const cookie of values) cookies.set(cookie.name, cookie.value); } } });
    const { error: loginError } = await client.auth.signInWithPassword({ email, password });
    expect(loginError).toBeNull();
    return Array.from(cookies).map(([key, value]) => key + '=' + value).join('; ');
  }
  try {
    const { error: salonError } = await db.from('salons').insert({ id: otherSalon, name: 'TEST isolamento Cassa', slug: 'fiscal-test-' + run });
    expect(salonError).toBeNull();
    const own = await staffCookie(document!.salon_id); const other = await staffCookie(otherSalon);
    const base = 'http://localhost:3000';
    const list = await fetch(base + '/api/cassa', { headers: { Cookie: own }, redirect: 'manual' });
    expect(list.status).toBe(200);
    const contents = await list.json(); expect(contents.documents.some((row: { id: string }) => row.id === document!.id)).toBe(true);
    expect(contents.documents.every((row: Record<string, unknown>) => !('pdf_storage_path' in row))).toBe(true);
    const download = await fetch(base + '/api/cassa/' + document!.id + '/pdf', { headers: { Cookie: own }, redirect: 'manual' });
    expect(download.status).toBe(200); expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect((await download.text()).slice(0, 5)).toBe('%PDF-');
    const crossSalonCancel = await fetch(base + '/api/appointments/29effce3-2bf0-4512-8db4-5a51d898eba3', { method: 'DELETE', headers: { Cookie: other }, redirect: 'manual' });
    expect(crossSalonCancel.status).toBe(404);
    const denied = await fetch(base + '/api/cassa/' + document!.id + '/pdf', { headers: { Cookie: other }, redirect: 'manual' });
    expect(denied.status).toBe(404);
    const otherList = await fetch(base + '/api/cassa', { headers: { Cookie: other }, redirect: 'manual' });
    expect(otherList.status).toBe(200); expect((await otherList.json()).documents).toHaveLength(0);
    const anonymous = await fetch(base + '/api/cassa/' + document!.id + '/pdf', { redirect: 'manual' });
    expect([401, 307]).toContain(anonymous.status);
    const browser = createClient(url, anon, { auth: { persistSession: false } });
    const { error: directError } = await browser.storage.from(FISCAL_BUCKET).download(document!.pdf_storage_path);
    expect(directError).toBeTruthy();
    const page = await fetch(base + '/cassa', { headers: { Cookie: own }, redirect: 'manual' });
    expect(page.status).toBe(200); expect(await page.text()).toContain('Cassa');
    console.log('PDF privato verificato; staff autorizzato: download OK; altro salone e anonimo: accesso negato.');
  } finally {
    for (const user of users) { const { error: cleanupError } = await db.auth.admin.deleteUser(user); expect(cleanupError).toBeNull(); }
    const { error: cleanupError } = await db.from('salons').delete().eq('id', otherSalon); expect(cleanupError).toBeNull();
  }
}, 120000);
