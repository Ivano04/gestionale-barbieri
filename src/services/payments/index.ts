import Stripe from 'stripe';
import { StripeProvider } from './stripe';
import { NexiProvider } from './nexi';
import type { PaymentProvider } from './types';

export type { PaymentProvider } from './types';

export interface PaymentProviderConfig {
  provider: 'stripe' | 'nexi';
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  nexiAlias?: string;
  nexiMacKey?: string;
  nexiEnv?: 'test' | 'live';
}

// Sorgente delle variabili d'ambiente (di default process.env; iniettabile per i test).
type EnvSource = Record<string, string | undefined>;

// Costruisce la configurazione del provider leggendo le variabili d'ambiente.
export function paymentConfigFromEnv(env: EnvSource = process.env): PaymentProviderConfig {
  return {
    provider: (env.PAYMENT_PROVIDER as 'stripe' | 'nexi') ?? 'nexi',
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    nexiAlias: env.NEXI_ALIAS,
    nexiMacKey: env.NEXI_MAC_KEY,
    nexiEnv: (env.NEXI_ENV as 'test' | 'live') ?? 'test',
  };
}

// Fabbrica: costruisce l'adattatore giusto dalla configurazione.
// Agnostica rispetto al resto dell'app: route e servizi dipendono da PaymentProvider,
// non da un provider concreto.
export function createPaymentProvider(config: PaymentProviderConfig): PaymentProvider {
  switch (config.provider) {
    case 'stripe': {
      if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
        throw new Error('Configurazione Stripe incompleta: servono STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET');
      }
      const stripe = new Stripe(config.stripeSecretKey);
      return new StripeProvider(stripe, config.stripeWebhookSecret);
    }
    case 'nexi': {
      if (!config.nexiAlias || !config.nexiMacKey) {
        throw new Error('Configurazione Nexi incompleta: servono NEXI_ALIAS e NEXI_MAC_KEY');
      }
      return new NexiProvider({
        alias: config.nexiAlias,
        macKey: config.nexiMacKey,
        env: config.nexiEnv ?? 'test',
      });
    }
    default:
      throw new Error(`Provider di pagamento non supportato: ${config.provider}`);
  }
}
