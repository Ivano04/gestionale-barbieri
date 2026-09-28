import { describe, it, expect } from 'vitest';
import { selectDueNotifications } from './cron-logic';

const now = new Date('2026-09-28T12:00:00Z');

function appt(id: string, startOffsetMs: number, durationMs = 30 * 60_000, status = 'confirmed') {
  const start = new Date(now.getTime() + startOffsetMs);
  const end = new Date(start.getTime() + durationMs);
  return { id, start_time: start.toISOString(), end_time: end.toISOString(), status };
}

const H = 60 * 60_000;

describe('selectDueNotifications', () => {
  it('promemoria dovuto per un appuntamento che inizia entro 2h', () => {
    const due = selectDueNotifications([appt('a', 1 * H)], now);
    expect(due).toEqual([{ appointmentId: 'a', type: 'reminder' }]);
  });

  it('nessun promemoria se inizia oltre 2h', () => {
    expect(selectDueNotifications([appt('a', 3 * H)], now)).toEqual([]);
  });

  it('nessun promemoria per un appuntamento in corso (iniziato ma non finito)', () => {
    // iniziato 1h fa, dura 3h → ancora in corso: niente promemoria, niente recensione
    expect(selectDueNotifications([appt('a', -1 * H, 3 * H)], now)).toEqual([]);
  });

  it('recensione dovuta per un appuntamento finito da poco (entro 24h)', () => {
    // inizia 2h fa, dura 30m → finito ~1h30 fa
    const due = selectDueNotifications([appt('a', -2 * H)], now);
    expect(due).toEqual([{ appointmentId: 'a', type: 'review' }]);
  });

  it('nessuna recensione se finito da piu\' di 24h', () => {
    expect(selectDueNotifications([appt('a', -30 * H)], now)).toEqual([]);
  });

  it('ignora gli appuntamenti annullati', () => {
    expect(selectDueNotifications([appt('a', 1 * H, 30 * 60_000, 'cancelled')], now)).toEqual([]);
  });
});
