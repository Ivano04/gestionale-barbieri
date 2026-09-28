import { describe, it, expect } from 'vitest';
import { confirmationEmail, reminderEmail, reviewEmail } from './templates';

describe('confirmationEmail', () => {
  const data = {
    clientName: 'Mario',
    serviceName: 'Piega',
    dateText: 'lunedì 23 dicembre 2026',
    timeText: '10:00',
    salonName: 'HairForce',
  };

  it('produce un oggetto con soggetto e html', () => {
    const email = confirmationEmail(data);
    expect(email.subject).toMatch(/conferma/i);
    expect(typeof email.html).toBe('string');
  });

  it('include i dati chiave della prenotazione nell\'html', () => {
    const html = confirmationEmail(data).html;
    expect(html).toContain('Mario');
    expect(html).toContain('Piega');
    expect(html).toContain('lunedì 23 dicembre 2026');
    expect(html).toContain('10:00');
    expect(html).toContain('HairForce');
  });
});

describe('reminderEmail', () => {
  const data = { clientName: 'Mario', serviceName: 'Piega', dateText: 'oggi', timeText: '10:00', salonName: 'HairForce' };

  it('ha un oggetto da promemoria e include ora e servizio', () => {
    const email = reminderEmail(data);
    expect(email.subject).toMatch(/promemoria|ricorda/i);
    expect(email.html).toContain('10:00');
    expect(email.html).toContain('Piega');
  });
});

describe('reviewEmail', () => {
  const base = { clientName: 'Mario', serviceName: 'Piega', dateText: 'ieri', timeText: '10:00', salonName: 'HairForce' };

  it('ha un oggetto sulla recensione', () => {
    expect(reviewEmail(base).subject).toMatch(/recensione|feedback|com'è andata/i);
  });

  it('include il link recensione quando fornito', () => {
    const html = reviewEmail({ ...base, reviewUrl: 'https://g.page/r/xyz' }).html;
    expect(html).toContain('https://g.page/r/xyz');
  });
});
