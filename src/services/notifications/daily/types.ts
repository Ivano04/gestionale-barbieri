import type { EmailMessage } from '../types';
export type DailyType = 'reminder' | 'review';
export interface DailyAppointment {
  id: string; startTime: string; endTime: string; status: 'confirmed' | 'completed';
  serviceName: string; stylistName: string | null;
}
export interface DailyContext {
  clientName: string; email: string | null; salonName: string; visitDate: string;
  firstStart: string; lastEnd: string; appointments: DailyAppointment[];
}
export interface DailyPayload extends Omit<EmailMessage, 'idempotencyKey'> { from: string }
export interface DailyJob {
  id: string; salon_id: string; client_id: string; visit_date: string; type: DailyType;
  state: string; context: DailyContext; payload: DailyPayload | null;
  lease_token: string; first_attempt_at: string | null; attempts: number;
}
export interface DailyHistoryRow {
  id: string; visit_date: string; type: DailyType; state: string;
  due_at: string | null; sent_at: string | null; last_error_code: string | null;
}
export function dailyStateLabel(row: DailyHistoryRow): string {
  const labels: Record<string, string> = {
    pending: 'Programmato', running: 'Invio in corso', sent: 'Inviato',
    cancelled: row.last_error_code === 'MESSAGE_EXPIRED' ? 'Non inviato: orario superato' : 'Annullato: nessun appuntamento valido',
    unavailable: 'Email assente o non valida',
    blocked: row.last_error_code === 'EMAIL_CONFIGURATION' ? 'Configurazione email da completare' : 'Destinatario non autorizzato per i test',
    uncertain: 'Esito da verificare: nessun nuovo invio automatico',
  };
  return labels[row.state] ?? 'Stato da verificare';
}
