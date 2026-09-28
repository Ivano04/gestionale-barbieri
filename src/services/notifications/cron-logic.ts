import type { NotificationType } from './types';

// Finestre temporali delle automazioni a tempo.
export const REMINDER_LEAD_MS = 2 * 60 * 60_000; // promemoria: entro 2h dall'inizio
export const REVIEW_WINDOW_MS = 24 * 60 * 60_000; // recensione: fino a 24h dopo la fine

export interface CronAppointment {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
}

export interface DueNotification {
  appointmentId: string;
  type: NotificationType;
}

// Decide, dato "ora", quali appuntamenti sono dovuti per un promemoria o una recensione.
// L'idempotenza (non reinviare) e' garantita a valle da sendBookingEmail (alreadySent).
export function selectDueNotifications(appointments: CronAppointment[], now: Date): DueNotification[] {
  const t = now.getTime();
  const due: DueNotification[] = [];

  for (const a of appointments) {
    if (a.status === 'cancelled') continue;
    const start = new Date(a.start_time).getTime();
    const end = new Date(a.end_time).getTime();

    // Promemoria: l'appuntamento inizia nel futuro, entro REMINDER_LEAD_MS
    if (start > t && start - t <= REMINDER_LEAD_MS) {
      due.push({ appointmentId: a.id, type: 'reminder' });
      continue;
    }

    // Recensione: l'appuntamento e' finito, da non piu' di REVIEW_WINDOW_MS
    if (end <= t && t - end <= REVIEW_WINDOW_MS) {
      due.push({ appointmentId: a.id, type: 'review' });
    }
  }

  return due;
}
