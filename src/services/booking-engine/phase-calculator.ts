import type { Service, ServiceOverride, PhaseBreakdown } from '@/lib/types';

/**
 * Computes the phase breakdown for a service+stylist combination.
 * If per-stylist overrides exist, they take precedence.
 * If service has no phase columns set, falls back to duration_minutes as a single active phase.
 */
export function computePhaseBreakdown(
  service: Pick<Service, 'duration_minutes' | 'duration_application' | 'duration_processing' | 'duration_finishing' | 'buffer_time_minutes'>,
  override?: Pick<ServiceOverride, 'duration_application' | 'duration_processing' | 'duration_finishing' | 'buffer_time_minutes'> | null,
): PhaseBreakdown {
  const app  = override?.duration_application  ?? service.duration_application;
  const proc = override?.duration_processing   ?? service.duration_processing;
  const fin  = override?.duration_finishing    ?? service.duration_finishing;

  const hasPhases = app != null || proc != null || fin != null;

  let application: number;
  let processing: number;
  let finishing: number;

  if (hasPhases) {
    application = app ?? 0;
    processing = proc ?? 0;
    finishing = fin ?? 0;
  } else {
    // Legacy: entire duration is active (application)
    application = service.duration_minutes;
    processing = 0;
    finishing = 0;
  }

  const buffer = override?.buffer_time_minutes ?? service.buffer_time_minutes ?? 0;
  const client = application + processing + finishing;

  return {
    application,
    processing,
    finishing,
    buffer,
    totalClientVisible: client,
    totalInternal: client + buffer,
  };
}

/**
 * Given a start time (minutes since midnight) and a phase breakdown,
 * returns the time ranges for each phase relative to start.
 */
export interface PhaseRanges {
  application: { start: number; end: number };  // stylist busy
  processing:   { start: number; end: number };  // stylist FREE for other short services
  finishing:    { start: number; end: number };  // stylist busy
  buffer:       { start: number; end: number };  // stylist busy (cleanup), invisible to client
  clientEnd:    number;                           // end time shown to client
  internalEnd:  number;                           // end time for stylist blocking
}

export function computePhaseRanges(startMinutes: number, phases: PhaseBreakdown): PhaseRanges {
  const appStart  = startMinutes;
  const appEnd    = appStart + phases.application;
  const procStart = appEnd;
  const procEnd   = procStart + phases.processing;
  const finStart  = procEnd;
  const finEnd    = finStart + phases.finishing;
  const bufEnd    = finEnd + phases.buffer;

  return {
    application: { start: appStart, end: appEnd },
    processing:  { start: procStart, end: procEnd },
    finishing:   { start: finStart, end: finEnd },
    buffer:      { start: finEnd, end: bufEnd },
    clientEnd:   finEnd,
    internalEnd: bufEnd,
  };
}

/**
 * Returns true if the stylist is in an active phase (not processing) at the given minute.
 */
export function isStylistBusy(minute: number, ranges: PhaseRanges): boolean {
  return (
    (ranges.application.start < ranges.application.end && minute >= ranges.application.start && minute < ranges.application.end) ||
    (ranges.finishing.start < ranges.finishing.end && minute >= ranges.finishing.start && minute < ranges.finishing.end) ||
    (ranges.buffer.start < ranges.buffer.end && minute >= ranges.buffer.start && minute < ranges.buffer.end)
  );
}
