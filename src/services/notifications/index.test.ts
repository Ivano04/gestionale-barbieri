import { describe, it, expect } from 'vitest';
import { createEmailProvider, emailConfigFromEnv } from './index';
import { ResendProvider } from './resend';

describe('createEmailProvider', () => {
  it('restituisce un ResendProvider quando c\'e\' la API key', () => {
    const provider = createEmailProvider({ apiKey: 're_test_x', from: 'x@y.it' });
    expect(provider).toBeInstanceOf(ResendProvider);
  });

  it('lancia se manca la API key', () => {
    expect(() => createEmailProvider({})).toThrow(/resend|api key/i);
  });
});

describe('emailConfigFromEnv', () => {
  it('mappa RESEND_API_KEY e RESEND_FROM', () => {
    const c = emailConfigFromEnv({ RESEND_API_KEY: 're_1', RESEND_FROM: 'Salone <x@y.it>' });
    expect(c.apiKey).toBe('re_1');
    expect(c.from).toBe('Salone <x@y.it>');
  });
});
