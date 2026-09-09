import { describe, it, expect } from 'vitest';
import { createPaymentProvider, paymentConfigFromEnv } from './index';
import { StripeProvider } from './stripe';
import { NexiProvider } from './nexi';

describe('paymentConfigFromEnv', () => {
  it('mappa le variabili d\'ambiente Nexi nella configurazione', () => {
    const config = paymentConfigFromEnv({
      PAYMENT_PROVIDER: 'nexi',
      NEXI_ALIAS: 'ALIAS_WEB_1',
      NEXI_MAC_KEY: 'secret',
      NEXI_ENV: 'test',
    });
    expect(config.provider).toBe('nexi');
    expect(config.nexiAlias).toBe('ALIAS_WEB_1');
    expect(config.nexiMacKey).toBe('secret');
    expect(config.nexiEnv).toBe('test');
  });

  it('produce una config utilizzabile dalla fabbrica', () => {
    const provider = createPaymentProvider(paymentConfigFromEnv({
      PAYMENT_PROVIDER: 'nexi',
      NEXI_ALIAS: 'ALIAS_WEB_1',
      NEXI_MAC_KEY: 'secret',
      NEXI_ENV: 'test',
    }));
    expect(provider).toBeInstanceOf(NexiProvider);
  });
});

describe('createPaymentProvider', () => {
  it('restituisce un StripeProvider quando il provider e\' "stripe"', () => {
    const provider = createPaymentProvider({
      provider: 'stripe',
      stripeSecretKey: 'sk_test_x',
      stripeWebhookSecret: 'whsec_x',
    });
    expect(provider).toBeInstanceOf(StripeProvider);
  });

  it('lancia un errore chiaro se mancano le chiavi Stripe', () => {
    expect(() => createPaymentProvider({ provider: 'stripe' })).toThrow(/stripe/i);
  });

  it('restituisce un NexiProvider quando il provider e\' "nexi"', () => {
    const provider = createPaymentProvider({
      provider: 'nexi',
      nexiAlias: 'ALIAS_X',
      nexiMacKey: 'KEY_X',
      nexiEnv: 'test',
    });
    expect(provider).toBeInstanceOf(NexiProvider);
  });

  it('lancia un errore chiaro se mancano le credenziali Nexi', () => {
    expect(() => createPaymentProvider({ provider: 'nexi' })).toThrow(/nexi/i);
  });

  it('lancia un errore chiaro se il provider non e\' supportato', () => {
    expect(() => createPaymentProvider({ provider: 'paypal' as any })).toThrow(/supportato|paypal/i);
  });
});
