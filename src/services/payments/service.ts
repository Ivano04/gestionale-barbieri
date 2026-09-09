import type { PaymentProvider, PaymentStatus } from './types';

// Riga di pagamento da inserire (mappa 1:1 sulle colonne della tabella payments).
export interface NewPaymentRow {
  salon_id: string;
  appointment_id?: string | null;
  client_id?: string | null;
  provider: 'stripe' | 'nexi';
  provider_payment_id: string;
  amount_cents: number;
  currency: string;
  status: PaymentStatus;
  metadata?: Record<string, unknown> | null;
}

export interface PaymentPatch {
  status?: PaymentStatus;
  metadata?: Record<string, unknown> | null;
  appointment_id?: string | null;
}

// Riga di pagamento letta dal DB (campi che servono alla conferma prenotazione).
export interface PaymentRow {
  id: string;
  appointment_id: string | null;
  status: PaymentStatus;
  metadata: Record<string, unknown> | null;
}

// "Porta" verso la persistenza: l'implementazione concreta (Supabase) sta altrove,
// cosi' la logica di business e' testabile senza toccare il DB.
export interface PaymentsRepo {
  insertPending(row: NewPaymentRow): Promise<{ id: string }>;
  updateByProviderRef(providerRef: string, patch: PaymentPatch): Promise<void>;
  getByProviderRef(providerRef: string): Promise<PaymentRow | null>;
}

export interface CreateCheckoutInput {
  salonId: string;
  amountCents: number;
  providerName: 'stripe' | 'nexi';
  successUrl: string;
  cancelUrl: string;
  notifyUrl?: string;
  currency?: string;
  appointmentId?: string | null;
  clientId?: string | null;
  productName?: string;
  /** Metadata passati al provider (stringhe) — usati da Stripe */
  metadata?: Record<string, string>;
  /** Oggetto salvato nella colonna payments.metadata (jsonb) — es. prenotazione + slot */
  rowMetadata?: Record<string, unknown>;
}

// Crea la sessione di pagamento e registra una riga payments in stato pending.
export async function createPaymentCheckout(args: {
  provider: PaymentProvider;
  repo: PaymentsRepo;
  input: CreateCheckoutInput;
}): Promise<{ url: string; providerRef: string; method?: 'GET' | 'POST'; fields?: Record<string, string>; paymentId: string }> {
  const { provider, repo, input } = args;

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('Importo non valido: deve essere un intero positivo in centesimi');
  }

  const currency = input.currency ?? 'EUR';

  const checkout = await provider.createCheckout({
    amountCents: input.amountCents,
    currency,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    notifyUrl: input.notifyUrl,
    productName: input.productName,
    metadata: input.metadata,
  });

  const { id } = await repo.insertPending({
    salon_id: input.salonId,
    appointment_id: input.appointmentId ?? null,
    client_id: input.clientId ?? null,
    provider: input.providerName,
    provider_payment_id: checkout.providerRef,
    amount_cents: input.amountCents,
    currency,
    status: 'pending',
    metadata: input.rowMetadata ?? input.metadata ?? null,
  });

  return {
    url: checkout.url,
    providerRef: checkout.providerRef,
    method: checkout.method,
    fields: checkout.fields,
    paymentId: id,
  };
}
