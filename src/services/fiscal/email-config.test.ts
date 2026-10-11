import { describe, expect, it } from 'vitest';
import { fiscalTestEmailConfig } from './email-config';
import { fiscalTestEmailPayload } from './email-template';
describe('fiscal TEST email configuration', () => {
  const env = { FISKALY_TEST_EMAIL_ENABLED: 'true', FISKALY_ENV: 'test', NEXI_ENV: 'test', RESEND_API_KEY: 'fake', FISKALY_TEST_EMAIL_TO: 'test@example.invalid' };
  it('requires explicit activation and one authorized recipient', () => {
    expect(fiscalTestEmailConfig({})).toBeNull();
    expect(fiscalTestEmailConfig(env)?.to).toBe('test@example.invalid');
    expect(() => fiscalTestEmailConfig({ ...env, FISKALY_TEST_EMAIL_TO: 'one@x.it,two@x.it' })).toThrow();
    expect(() => fiscalTestEmailConfig({ ...env, RESEND_API_KEY: '' })).toThrow();
    expect(() => fiscalTestEmailConfig({ ...env, FISKALY_ENV: 'live' })).toThrow();
  });
  it('labels cancellation documents distinctly', () => {
    const email = fiscalTestEmailPayload({ from:'from@x.it', to:'test@x.it', salonName:'TEST', number:'TEST-1', amountCents:2440, operation:'cancellation' });
    expect(email.subject).toContain('Annullo ricevuta TEST');
    expect(email.html).toContain('Annullo ricevuta TEST');
  });
  it('escapes salon data and labels the attachment as TEST', () => {
    const result = fiscalTestEmailPayload({ from: 'from@x.it', to: 'test@x.it', salonName: '<script>evil</script>', number: 'TEST-1', amountCents: 2440 });
    expect(result.html).not.toContain('<script>'); expect(result.html).toContain('&lt;script&gt;');
    expect(result.subject).toContain('TEST'); expect(result.text).toContain('non ha valore fiscale'); expect(result.text).toContain('24,40');
  });
});
