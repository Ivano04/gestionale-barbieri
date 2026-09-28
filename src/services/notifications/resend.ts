import type { Resend } from 'resend';
import type { EmailMessage, EmailProvider } from './types';

// Adattatore Resend. Il client e' iniettato dal costruttore (DI) per la testabilita'.
export class ResendProvider implements EmailProvider {
  constructor(
    private readonly client: Pick<Resend, 'emails'>,
    private readonly from: string,
  ) {}

  async send(msg: EmailMessage): Promise<{ id: string }> {
    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
    } as any);

    if (error) {
      throw new Error(`Invio email fallito: ${error.message}`);
    }
    return { id: data!.id };
  }
}
