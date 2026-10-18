import { randomUUID } from 'node:crypto';
import { fiscalStaffAccess } from '@/services/fiscal/staff-access';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildSalonReceipt, parseBasket } from '@/services/checkout/basket';
import { checkoutContext, databaseError, json, snapshot, UUID } from '@/services/checkout/repo';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const access = await fiscalStaffAccess(); if (access.response) return access.response;
  const { id } = await context.params; if (!UUID.test(id)) return json({ error: 'Identificativo non valido' }, 400);
  try { const data = await checkoutContext(id, access.salonId); return data ? json(data) : json({ error: 'Appuntamento non trovato' }, 404); }
  catch { return json({ error: 'Impossibile caricare la cassa' }, 503); }
}
export async function POST(request: Request, context: Context) {
  const access = await fiscalStaffAccess(); if (access.response) return access.response;
  const { id } = await context.params; if (!UUID.test(id)) return json({ error: 'Identificativo non valido' }, 400);
  if (process.env.FISKALY_ENV !== 'test' || process.env.FISKALY_TEST_ENABLED !== 'true' || process.env.NEXI_ENV !== 'test') return json({ error: 'Emissione disponibile soltanto in ambiente TEST' }, 503);
  let input: Record<string, unknown>;
  try { input = await request.json(); if (!input || typeof input !== 'object') throw new Error(); }
  catch { return json({ error: 'Richiesta non valida' }, 400); }
  if (typeof input.requestId !== 'string' || !UUID.test(input.requestId) || !['cash','card'].includes(String(input.method)) || input.confirmed !== true || typeof input.expectedUpdate !== 'string' || !Number.isFinite(Date.parse(input.expectedUpdate)) || input.quoteId != null && (typeof input.quoteId !== 'string' || !UUID.test(input.quoteId) || !Number.isInteger(input.quoteVersion))) return json({ error: 'Conferma incasso e dati completi richiesti' }, 400);
  let basket;
  try { basket = parseBasket(input.lines); } catch (e) { return json({ error: e instanceof Error ? e.message : 'Voci non valide' }, 400); }
  try {
    const data = await checkoutContext(id, access.salonId); if (!data) return json({ error: 'Appuntamento non trovato' }, 404);
    const db = createAdminClient();
    const { data: previous, error: previousError } = await db.from('salon_sales').select('appointment_id,snapshot,payment_method,quote_id,quote_version').eq('id', input.requestId).eq('salon_id', access.salonId).maybeSingle();
    if (previousError) throw new Error();
    let receiptSnapshot = snapshot(data, basket.lines);
    if (previous) {
      if (previous.appointment_id !== id || previous.payment_method !== input.method || previous.quote_id !== (input.quoteId ?? null) || previous.quote_version !== (input.quoteVersion ?? null) || JSON.stringify(parseBasket(previous.snapshot.lines).lines) !== JSON.stringify(basket.lines)) return databaseError('CONFLICTING_REQUEST');
      receiptSnapshot = previous.snapshot;
    } else if (input.quoteId) {
      if (!data.quote || data.quote.id !== input.quoteId || data.quote.version !== input.quoteVersion || data.quote.status !== 'draft' || (data.quote.snapshot.clientId ?? null) !== (data.snapshotBase.clientId ?? null) || JSON.stringify(parseBasket(data.quote.snapshot.lines).lines) !== JSON.stringify(basket.lines)) return databaseError('STALE_QUOTE');
      receiptSnapshot = data.quote.snapshot;
    }
    const method = input.method as 'cash' | 'card';
    const operation = buildSalonReceipt(basket, 'TEST-' + randomUUID().replaceAll('-', '').slice(0, 15).toUpperCase(), Number(process.env.FISKALY_TEST_VAT_PERCENT ?? '22'), method);
    const { data: documentId, error } = await db.rpc('register_salon_sale_test', { p_id: input.requestId, p_salon: access.salonId, p_appointment: id, p_actor: access.userId,
      p_expected_update: input.expectedUpdate, p_snapshot: receiptSnapshot, p_method: method, p_operation: operation, p_quote_id: input.quoteId ?? null, p_quote_version: input.quoteVersion ?? null });
    if (error) return databaseError(error.message);
    return json({ documentId, saleId: input.requestId, recorded: true });
  } catch { return json({ error: 'Esito non disponibile. Riprova senza cambiare i dati o aggiorna la cassa.' }, 503); }
}
