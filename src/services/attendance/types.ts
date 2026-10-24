export interface AttendanceMember {
  id: string; updatedAt: string; startTime: string; endTime: string;
  status: 'confirmed' | 'completed' | 'cancelled' | 'no_show'; serviceName: string; stylistName: string | null;
}
export interface AttendanceEmail { state: string; availableAt: string; sentAt: string | null; reason: string | null }
export interface AttendanceContext { members: AttendanceMember[]; visitEnd: string; serverNow: string; canMark: boolean; hasEmail: boolean; email: AttendanceEmail | null }
export const attendanceEmailLabel = (email: AttendanceEmail | null, hasEmail = true): string => {
  if (!email) return hasEmail ? 'Email prevista 30 minuti dopo la segnalazione.' : 'Email assente: nessun messaggio automatico. SMS non attivi.';
  const labels: Record<string,string> = { pending: 'Email programmata', running: 'Invio email in corso', sent: 'Email inviata', cancelled: 'Email annullata', unavailable: 'Email assente o non valida: nessun messaggio inviato. SMS non attivi.', blocked: 'Email non inviata: destinatario non autorizzato per i test.', failed: 'Email non inviata: errore da verificare.', uncertain: 'Esito email da verificare prima di un nuovo invio.' };
  return labels[email.state] ?? 'Stato email da verificare';
};
