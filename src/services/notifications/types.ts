// Interfaccia comune dei provider email (come PaymentProvider per i pagamenti).
// Resend e' l'implementazione attuale; l'interfaccia consente di sostituirlo.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailProvider {
  /** Invia una email. Restituisce l'id del messaggio del provider. Lancia in caso di errore. */
  send(msg: EmailMessage): Promise<{ id: string }>;
}

export type NotificationType = 'confirmation' | 'reminder' | 'review';
