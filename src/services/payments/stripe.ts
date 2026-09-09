import type Stripe from 'stripe';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  PaymentProvider,
  PaymentStatus,
  WebhookEvent,
} from './types';

// Traduce un tipo di evento Stripe nello stato di pagamento normalizzato.
function mapEventToStatus(type: string, obj: Record<string, any>): PaymentStatus {
  switch (type) {
    case 'checkout.session.completed':
      return obj.payment_status === 'paid' ? 'succeeded' : 'pending';
    case 'checkout.session.expired':
      return 'canceled';
    case 'payment_intent.payment_failed':
      return 'failed';
    case 'charge.refunded':
      return 'refunded';
    default:
      return 'pending';
  }
}

// Adattatore Stripe dell'interfaccia PaymentProvider.
// Il client Stripe e' iniettato dal costruttore (dependency injection): questo rende
// l'adattatore testabile con un client finto, senza toccare la rete.
export class StripeProvider implements PaymentProvider {
  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
  ) {}

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const currency = (params.currency ?? 'EUR').toLowerCase();
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: params.amountCents,
            product_data: { name: params.productName ?? 'Pagamento' },
          },
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
    });

    return { url: session.url ?? '', providerRef: session.id };
  }

  verifyWebhook(rawBody: string, signature: string): WebhookEvent {
    // constructEvent verifica la firma HMAC col webhook secret e lancia se non e' valida.
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const obj = (event.data?.object ?? {}) as Record<string, any>;

    return {
      type: event.type,
      providerRef: obj.id ?? '',
      amountCents: obj.amount_total ?? obj.amount ?? null,
      status: mapEventToStatus(event.type, obj),
      raw: event,
    };
  }

  // providerRef qui e' il payment_intent (l'id del pagamento rimborsabile),
  // non l'id della sessione Checkout.
  async refund(paymentIntentRef: string, amountCents?: number): Promise<void> {
    await this.stripe.refunds.create({
      payment_intent: paymentIntentRef,
      ...(amountCents != null ? { amount: amountCents } : {}),
    });
  }
}
