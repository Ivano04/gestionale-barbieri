import { describe, expect, it, vi } from 'vitest';
import type { Resend } from 'resend';
import { fiscalResendSender } from './email-resend';
import { FiscalEmailSendError } from './email-worker';
describe('fiscal Resend adapter', () => {
  const payload = { from: 'from@x.it', to: 'test@x.it', subject: 'TEST', html: '<p>TEST</p>', text: 'TEST' };
  it('attaches PDF bytes and sends the idempotency key through the SDK', async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: 'email' }, error: null });
    const sender = fiscalResendSender({ emails: { send } } as unknown as Pick<Resend, 'emails'>);
    expect(await sender.send(payload, Buffer.from('%PDF-TEST'), 'stable', 'test.pdf')).toBe('email');
    expect(send).toHaveBeenCalledWith({ ...payload, attachments: [{ filename: 'test.pdf', content: Buffer.from('%PDF-TEST').toString('base64'), contentType: 'application/pdf' }] }, { idempotencyKey: 'stable' });
  });
  it('classifies rate limiting as retryable without exposing provider messages', async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'private diagnostic' } });
    const sender = fiscalResendSender({ emails: { send } } as unknown as Pick<Resend, 'emails'>);
    const error = await sender.send(payload, Buffer.from('%PDF-TEST'), 'key', 'test.pdf').catch(error => error);
    expect(error).toBeInstanceOf(FiscalEmailSendError); expect(error.retryable).toBe(true); expect(error.message).not.toContain('private');
  });
});
