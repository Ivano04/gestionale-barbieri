import { randomUUID } from 'node:crypto';
import { fiscalStaffAccess } from '@/services/fiscal/staff-access';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkoutContext, databaseError, json, snapshot, UUID } from '@/services/checkout/repo';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await fiscalStaffAccess(); if (access.response) return access.response;
  const { id } = await params; if (!UUID.test(id)) return json({ error: 'Identificativo non valido' }, 400);
  let input: Record<string, unknown>;
  try { input = await request.json(); if (!input || typeof input !== 'object') throw new Error(); } catch { return json({ error: 'Richiesta non valida' }, 400); }
  if (typeof input.quoteId !== 'string' || !UUID.test(input.quoteId) || !Number.isInteger(input.version) || Number(input.version) < 0 || typeof input.expectedUpdate !== 'string' || !Number.isFinite(Date.parse(input.expectedUpdate)) || typeof input.validUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil) || !Number.isFinite(Date.parse(input.validUntil)) || new Date(input.validUntil).toISOString().slice(0,10) !== input.validUntil) return json({ error: 'Dati del preventivo non validi' }, 400);
  try {
    const data = await checkoutContext(id, access.salonId); if (!data) return json({ error: 'Appuntamento non trovato' }, 404);
    let body;
    try { body = snapshot(data, input.lines); } catch (e) { return json({ error: e instanceof Error ? e.message : 'Voci non valide' }, 400); }
    const db = createAdminClient();
    const { error } = await db.rpc('save_appointment_quote', { p_id: input.quoteId || randomUUID(), p_salon: access.salonId, p_appointment: id, p_actor: access.userId,
      p_version: input.version, p_expected_update: input.expectedUpdate, p_snapshot: body, p_valid_until: input.validUntil });
    if (error) return databaseError(error.message);
    const { data: quote, error: readError } = await db.from('appointment_quotes').select('*').eq('id', input.quoteId).eq('salon_id', access.salonId).single();
    if (readError) throw new Error();
    return json({ quote });
  } catch { return json({ error: 'Impossibile confermare il salvataggio. Ricarica il preventivo.' }, 503); }
}
