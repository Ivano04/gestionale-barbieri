import type { EmailProvider, NotificationType } from './types';
import { confirmationEmail, reminderEmail, reviewEmail, type BookingEmailData, type RenderedEmail } from './templates';

// "Porta" verso la persistenza delle notifiche (idempotenza + tracciamento).
export interface NotificationsRepo {
  alreadySent(appointmentId: string, type: NotificationType): Promise<boolean>;
  markSent(row: { salon_id: string; appointment_id: string; type: NotificationType }): Promise<void>;
}

export interface NotificationData extends BookingEmailData {
  salonId: string;
  appointmentId: string;
  to: string;
}

// Alias storico
export type ConfirmationData = NotificationData;

const TEMPLATES: Record<NotificationType, (d: BookingEmailData) => RenderedEmail> = {
  confirmation: confirmationEmail,
  reminder: reminderEmail,
  review: reviewEmail,
};

// Invia una email di prenotazione del tipo dato, una sola volta (idempotente per tipo).
// Non invia se manca l'email del cliente.
export async function sendBookingEmail(args: {
  provider: EmailProvider;
  repo: NotificationsRepo;
  type: NotificationType;
  data: NotificationData;
}): Promise<void> {
  const { provider, repo, type, data } = args;

  if (!data.to) return;
  if (await repo.alreadySent(data.appointmentId, type)) return;

  const email = TEMPLATES[type](data);
  await provider.send({ to: data.to, subject: email.subject, html: email.html, text: email.text });

  await repo.markSent({ salon_id: data.salonId, appointment_id: data.appointmentId, type });
}

// Comodità per la conferma (usata dalla creazione appuntamento).
export async function sendConfirmation(args: {
  provider: EmailProvider;
  repo: NotificationsRepo;
  data: NotificationData;
}): Promise<void> {
  return sendBookingEmail({ ...args, type: 'confirmation' });
}
