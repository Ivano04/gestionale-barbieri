import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { runFiscalEmailOnce, FiscalEmailSendError, type FiscalEmailJob, type FiscalEmailRepo } from './email-worker';
const pdf = Buffer.from('%PDF-TEST');
const job: FiscalEmailJob = { id: 'job', salon_id: 'salon', document_id: 'document', mode: 'test', recipient: 'test@example.invalid',
  payload: { from: 'from@example.invalid', to: 'test@example.invalid', subject: 'TEST', html: '<p>TEST</p>', text: 'TEST' },
  pdf_path: 'salon/test/document.pdf', pdf_sha256: createHash('sha256').update(pdf).digest('hex'),
  idempotency_key: 'stable-key', attempts: 1, first_attempt_at: new Date().toISOString(), lease_token: 'lease' };
function setup(overrides: Partial<FiscalEmailJob> = {}) {
  const repo = { claim: vi.fn().mockResolvedValue({ ...job, ...overrides }), download: vi.fn().mockResolvedValue(pdf), checkpoint: vi.fn().mockResolvedValue(undefined) } satisfies FiscalEmailRepo;
  const sender = { send: vi.fn().mockResolvedValue('email-id') };
  return { repo, sender };
}
describe('fiscal receipt email worker', () => {
  it('sends the PDF with a stable key and checkpoints provider acceptance', async () => {
    const { repo, sender } = setup(); await runFiscalEmailOnce(repo, sender, job.recipient);
    expect(sender.send).toHaveBeenCalledWith(job.payload, pdf, 'fiscal-test/stable-key', 'ricevuta-test-document.pdf');
    expect(repo.checkpoint).toHaveBeenCalledWith(expect.anything(), 'sent', 'email-id');
  });
  it('reuses payload and key after an accepted request loses its response', async () => {
    const { repo, sender } = setup(); sender.send.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('email-id');
    await runFiscalEmailOnce(repo, sender, job.recipient); await runFiscalEmailOnce(repo, sender, job.recipient);
    expect(sender.send.mock.calls[0]).toEqual(sender.send.mock.calls[1]);
    expect(repo.checkpoint.mock.calls[0][1]).toBe('retry'); expect(repo.checkpoint.mock.calls[1][1]).toBe('sent');
  });
  it('does not resend outside the idempotency window', async () => {
    const { repo, sender } = setup({ first_attempt_at: new Date(Date.now() - 24 * 3600000).toISOString() });
    await runFiscalEmailOnce(repo, sender, job.recipient);
    expect(sender.send).not.toHaveBeenCalled(); expect(repo.checkpoint).toHaveBeenCalledWith(expect.anything(), 'uncertain', undefined, 'IDEMPOTENCY_WINDOW_EXPIRED');
  });
  it('rejects unauthorized recipients and LIVE documents', async () => {
    for (const overrides of [{ recipient: 'other@example.invalid' }, { mode: 'live' }, { pdf_path: 'other/test/document.pdf' }]) {
      const { repo, sender } = setup(overrides); await runFiscalEmailOnce(repo, sender, job.recipient);
      expect(sender.send).not.toHaveBeenCalled(); expect(repo.checkpoint.mock.calls[0][1]).toBe('failed');
    }
  });
  it('does not send an attachment that changed since enqueue', async () => {
    const { repo, sender } = setup(); repo.download.mockResolvedValue(Buffer.from('%PDF-CHANGED'));
    await runFiscalEmailOnce(repo, sender, job.recipient); expect(sender.send).not.toHaveBeenCalled();
    expect(repo.checkpoint).toHaveBeenCalledWith(expect.anything(), 'failed', undefined, 'EMAIL_PDF_CHANGED');
  });
  it('stops on provider validation errors', async () => {
    const { repo, sender } = setup(); sender.send.mockRejectedValue(new FiscalEmailSendError(false, 'RESEND_VALIDATION_ERROR'));
    await runFiscalEmailOnce(repo, sender, job.recipient); expect(repo.checkpoint.mock.calls[0][1]).toBe('failed');
  });
  it('lets the lease expire if saving provider acceptance fails', async () => {
    const { repo, sender } = setup(); repo.checkpoint.mockRejectedValue(new Error('DB unavailable'));
    await expect(runFiscalEmailOnce(repo, sender, job.recipient)).rejects.toThrow('DB unavailable');
    expect(repo.checkpoint).toHaveBeenCalledTimes(1);
  });
});
