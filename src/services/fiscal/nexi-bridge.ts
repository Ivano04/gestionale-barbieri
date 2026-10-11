import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebhookEvent } from '@/services/payments/types';

export async function registerNexiFiscalTest(db: SupabaseClient, event: WebhookEvent): Promise<string> {
  if (event.status !== 'succeeded' || !Number.isSafeInteger(event.amountCents) || !event.amountCents) {
    throw new Error('Verified successful payment required');
  }
  const raw = event.raw as Record<string, unknown>;
  if (raw.divisa !== 'EUR' || typeof raw.importo !== 'string' || !/^[0-9]+$/.test(raw.importo) || Number(raw.importo) !== event.amountCents) throw new Error('Unexpected Nexi currency');
  const { data: payment, error } = await db.from('payments')
    .select('id,provider,metadata,amount_cents,status').eq('provider','nexi')
    .eq('provider_payment_id',event.providerRef).single();
  if (error || !payment || payment.amount_cents !== event.amountCents ||
      payment.metadata?.payment_environment !== 'test' || !payment.metadata?.fiscal_receipt) {
    throw new Error('TEST payment snapshot missing or mismatched');
  }
  // A delayed duplicate success must not undo a refund or recreate the appointment.
  if (['refunded', 'partially_refunded'].includes(payment.status)) {
    const { data: priorEvent, error: eventError } = await db.from('payment_events').select('id')
      .eq('payment_id', payment.id).eq('provider', 'nexi').eq('mode', 'test')
      .eq('event_key', 'nexi:' + event.providerRef + ':succeeded').eq('status', 'succeeded')
      .eq('amount_cents', event.amountCents).maybeSingle();
    const { data: priorDocument, error: documentError } = await db.from('fiscal_documents').select('id')
      .eq('payment_id', payment.id).eq('provider', 'fiskaly').eq('mode', 'test').eq('operation', 'receipt').maybeSingle();
    if (eventError || documentError || !priorEvent || !priorDocument) throw new Error('Refunded payment event not previously verified');
    return priorDocument.id;
  }
  const { data, error: saveError } = await db.rpc('register_paid_fiscal_test', {
    p_payment_id: payment.id, p_event_key: 'nexi:' + event.providerRef + ':succeeded',
    p_amount_cents: event.amountCents, p_operation: payment.metadata.fiscal_receipt,
  });
  if (saveError || typeof data !== 'string') throw new Error('Fiscal payment transaction failed');
  return data;
}

// Called after booking confirmation, including duplicate webhook deliveries.
export async function linkNexiFiscalAppointment(db: SupabaseClient, providerRef: string): Promise<void> {
  const { data: payment, error } = await db.from('payments')
    .select('id,salon_id,appointment_id').eq('provider', 'nexi')
    .eq('provider_payment_id', providerRef).single();
  if (error || !payment?.appointment_id) throw new Error('Confirmed fiscal appointment missing');
  const { data, error: linkError } = await db.from('fiscal_documents')
    .update({ appointment_id: payment.appointment_id })
    .eq('payment_id', payment.id).eq('salon_id', payment.salon_id)
    .eq('provider', 'fiskaly').eq('mode', 'test').eq('operation', 'receipt')
    .select('id').single();
  if (linkError || !data) throw new Error('Fiscal appointment link failed');
}
