import type { SupabaseClient } from '@supabase/supabase-js';
import type { NewPaymentRow, PaymentPatch, PaymentRow, PaymentsRepo } from './service';

// Implementazione Supabase della porta PaymentsRepo.
// Va usata con l'admin client (service-role), perche' le scritture su payments
// avvengono lato server dai webhook/route e la RLS consente ai membri solo la lettura.
export function createSupabasePaymentsRepo(supabase: SupabaseClient): PaymentsRepo {
  return {
    async insertPending(row: NewPaymentRow): Promise<{ id: string }> {
      const { data, error } = await supabase
        .from('payments')
        .insert(row)
        .select('id')
        .single();
      if (error) throw new Error(`Inserimento payment fallito: ${error.message}`);
      return { id: data.id };
    },

    async updateByProviderRef(providerRef: string, patch: PaymentPatch): Promise<void> {
      const { error } = await supabase
        .from('payments')
        .update(patch)
        .eq('provider_payment_id', providerRef);
      if (error) throw new Error(`Aggiornamento payment fallito: ${error.message}`);
    },

    async getByProviderRef(providerRef: string): Promise<PaymentRow | null> {
      const { data } = await supabase
        .from('payments')
        .select('id, appointment_id, status, metadata, provider_payment_id, amount_cents')
        .eq('provider_payment_id', providerRef)
        .maybeSingle();
      return (data as PaymentRow) ?? null;
    },
  };
}
