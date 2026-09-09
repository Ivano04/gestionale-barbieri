// Interfaccia comune dei provider di pagamento.
// Stripe e (in futuro) Nexi sono due adattatori intercambiabili dietro questa interfaccia.

export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'
  | 'canceled';

export interface CreateCheckoutParams {
  amountCents: number;
  currency?: string; // default: EUR
  successUrl: string;
  cancelUrl: string;
  /** URL server-to-server per la notifica dell'esito (usato da Nexi: "urlpost") */
  notifyUrl?: string;
  metadata?: Record<string, string>;
  productName?: string;
}

export interface CheckoutResult {
  /** URL della pagina di pagamento ospitata dal provider (Stripe) o endpoint da POSTare (Nexi) */
  url: string;
  /** Riferimento del provider: id sessione Checkout Stripe, oppure codTrans Nexi */
  providerRef: string;
  /**
   * Come il browser raggiunge `url`:
   *  - 'GET' (o assente): reindirizza il browser a `url` (Stripe)
   *  - 'POST': invia un form con `fields` verso `url` (Nexi Pagamento Semplice)
   */
  method?: 'GET' | 'POST';
  /** Campi del form da inviare in POST verso `url` (Nexi) */
  fields?: Record<string, string>;
}

export interface WebhookEvent {
  /** Tipo di evento grezzo del provider (es. "checkout.session.completed") */
  type: string;
  /** Riferimento del provider a cui l'evento si riferisce */
  providerRef: string;
  /** Importo in centesimi, se presente nell'evento */
  amountCents: number | null;
  /** Stato normalizzato del pagamento */
  status: PaymentStatus;
  /** Evento grezzo del provider, per debug/audit */
  raw: unknown;
}

export interface PaymentProvider {
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult>;
  verifyWebhook(rawBody: string, signature: string): WebhookEvent;
  refund(providerRef: string, amountCents?: number): Promise<void>;
}
