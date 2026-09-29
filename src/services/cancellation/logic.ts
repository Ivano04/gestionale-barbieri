// Logica pura della finestra di cancellazione.
// Il cliente ha diritto al rimborso se annulla con almeno "windowHours" di anticipo
// rispetto all'inizio dell'appuntamento; dentro la finestra non c'e' rimborso.

export const DEFAULT_CANCELLATION_HOURS = 24;

export function isRefundEligible(startIso: string, now: Date, windowHours: number): boolean {
  const lead = new Date(startIso).getTime() - now.getTime();
  return lead >= windowHours * 60 * 60_000;
}

export function cancellationWindowHours(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CANCELLATION_HOURS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CANCELLATION_HOURS;
}

export type CancelInitiator = 'client' | 'staff';

// Policy di rimborso alla cancellazione:
//  - staff: rimborsa sempre (e' il salone che annulla)
//  - cliente: rimborsa solo se annulla fuori dalla finestra
export function shouldRefundOnCancel(args: {
  startIso: string;
  now: Date;
  windowHours: number;
  initiatedBy: CancelInitiator;
}): boolean {
  if (args.initiatedBy === 'staff') return true;
  return isRefundEligible(args.startIso, args.now, args.windowHours);
}
