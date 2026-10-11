import { describe, expect, it } from 'vitest';
import { nexiNotifyUrl } from './notify-url';
const env = { PAYMENT_PROVIDER: 'nexi', NEXI_ENV: 'test', NEXI_TEST_NOTIFY_URL: 'https://example.test/api/webhooks/payments/nexi' };
describe('Nexi TEST callback URL', () => {
  it('uses a separate public callback while preserving the local app origin', () => {
    expect(nexiNotifyUrl('http://localhost:3000', env)).toBe(env.NEXI_TEST_NOTIFY_URL);
    expect(nexiNotifyUrl('http://localhost:3000', {})).toBe('http://localhost:3000/api/webhooks/payments/nexi');
  });
  it('rejects LIVE and non-Nexi overrides', () => {
    expect(() => nexiNotifyUrl('http://localhost:3000', { ...env, NEXI_ENV: 'live' })).toThrow();
    expect(() => nexiNotifyUrl('http://localhost:3000', { ...env, PAYMENT_PROVIDER: 'stripe' })).toThrow();
  });
  it('rejects credentials, query strings and non-webhook routes', () => {
    for (const url of ['http://example.test/api/webhooks/payments/nexi', 'https://example.test/calendar', 'https://user:pass@example.test/api/webhooks/payments/nexi', 'https://example.test/api/webhooks/payments/nexi?x=1', 'https://localhost/api/webhooks/payments/nexi']) {
      expect(() => nexiNotifyUrl('http://localhost:3000', { ...env, NEXI_TEST_NOTIFY_URL: url })).toThrow();
    }
  });
});
