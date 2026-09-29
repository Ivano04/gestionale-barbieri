export interface ApptForDeletionCheck {
  status: string;
  start_time: string;
}

// Un cliente non e' cancellabile se ha almeno un appuntamento "attivo e futuro":
// non annullato e con inizio da adesso in poi. Gli appuntamenti annullati o gia'
// passati (storico) non bloccano la cancellazione.
export function hasBlockingAppointment(appointments: ApptForDeletionCheck[], now: Date): boolean {
  const t = now.getTime();
  return appointments.some(
    (a) => a.status !== 'cancelled' && new Date(a.start_time).getTime() >= t,
  );
}
