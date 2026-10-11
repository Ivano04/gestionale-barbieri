import type { Resend } from 'resend';
import type { FiscalEmailPayload } from './email-template';
import { FiscalEmailSendError, type FiscalEmailSender } from './email-worker';
export function fiscalResendSender(client: Pick<Resend, 'emails'>): FiscalEmailSender {
  return { async send(payload: FiscalEmailPayload, pdf: Buffer, key: string, filename: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new FiscalEmailSendError(true, 'RESEND_TIMEOUT')), 30_000); });
    let result;
    try {
      result = await Promise.race([client.emails.send({ ...payload,
        attachments: [{ filename, content: pdf.toString('base64'), contentType: 'application/pdf' }],
      }, { idempotencyKey: key }), timeout]);
    } finally { clearTimeout(timer); }
    const { data, error } = result;
    if (error) {
      const transient = ['rate_limit_exceeded', 'application_error', 'internal_server_error', 'concurrent_idempotent_requests'].includes(error.name);
      throw new FiscalEmailSendError(transient, 'RESEND_' + error.name.toUpperCase());
    }
    if (!data?.id) throw new FiscalEmailSendError(true, 'EMAIL_RESPONSE_UNCERTAIN');
    return data.id;
  } };
}
