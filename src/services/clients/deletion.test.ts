import { describe, it, expect } from 'vitest';
import { hasBlockingAppointment } from './deletion';

const now = new Date('2026-09-29T12:00:00Z');
const future = '2026-10-05T10:00:00Z';
const past = '2026-09-01T10:00:00Z';

describe('hasBlockingAppointment', () => {
  it('blocca se c\'e\' un appuntamento futuro non annullato', () => {
    expect(hasBlockingAppointment([{ status: 'confirmed', start_time: future }], now)).toBe(true);
  });

  it('non blocca un appuntamento futuro ma annullato', () => {
    expect(hasBlockingAppointment([{ status: 'cancelled', start_time: future }], now)).toBe(false);
  });

  it('non blocca appuntamenti passati (storico), anche se confermati', () => {
    expect(hasBlockingAppointment([{ status: 'confirmed', start_time: past }], now)).toBe(false);
  });

  it('non blocca se non ci sono appuntamenti', () => {
    expect(hasBlockingAppointment([], now)).toBe(false);
  });

  it('blocca se almeno uno e\' futuro-attivo, ignorando annullati e passati', () => {
    const appts = [
      { status: 'cancelled', start_time: future },
      { status: 'confirmed', start_time: past },
      { status: 'confirmed', start_time: future },
    ];
    expect(hasBlockingAppointment(appts, now)).toBe(true);
  });
});
