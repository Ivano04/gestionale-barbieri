import { describe, it, expect } from 'vitest';
import { sendConfirmation, sendBookingEmail } from './service';

function makeFakeProvider() {
  const calls: any = { send: [] };
  return {
    calls,
    send: async (msg: any) => { calls.send.push(msg); return { id: 'email_1' }; },
  };
}

function makeFakeRepo(already = false) {
  const calls: any = { markSent: [] };
  return {
    calls,
    alreadySent: async () => already,
    markSent: async (row: any) => { calls.markSent.push(row); },
  };
}

const data = {
  salonId: 's1',
  appointmentId: 'a1',
  to: 'mario@x.it',
  clientName: 'Mario',
  serviceName: 'Piega',
  dateText: 'lunedì 23 dicembre 2026',
  timeText: '10:00',
  salonName: 'HairForce',
};

describe('sendConfirmation', () => {
  it('invia la conferma al cliente e registra la notifica', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo(false);

    await sendConfirmation({ provider: provider as any, repo: repo as any, data });

    expect(provider.calls.send).toHaveLength(1);
    expect(provider.calls.send[0].to).toBe('mario@x.it');
    expect(provider.calls.send[0].subject).toMatch(/conferma/i);
    expect(repo.calls.markSent[0]).toMatchObject({ appointment_id: 'a1', type: 'confirmation' });
  });

  it('e\' idempotente: se gia\' inviata non reinvia', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo(true);

    await sendConfirmation({ provider: provider as any, repo: repo as any, data });

    expect(provider.calls.send).toHaveLength(0);
  });

  it('non invia se il cliente non ha email', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo(false);

    await sendConfirmation({ provider: provider as any, repo: repo as any, data: { ...data, to: '' } });

    expect(provider.calls.send).toHaveLength(0);
    expect(repo.calls.markSent).toHaveLength(0);
  });
});

describe('sendBookingEmail (generico)', () => {
  it('invia il promemoria e registra la notifica di tipo reminder', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo(false);

    await sendBookingEmail({ provider: provider as any, repo: repo as any, type: 'reminder', data });

    expect(provider.calls.send).toHaveLength(1);
    expect(provider.calls.send[0].subject).toMatch(/promemoria/i);
    expect(repo.calls.markSent[0]).toMatchObject({ appointment_id: 'a1', type: 'reminder' });
  });

  it('invia la recensione e registra la notifica di tipo review', async () => {
    const provider = makeFakeProvider();
    const repo = makeFakeRepo(false);

    await sendBookingEmail({ provider: provider as any, repo: repo as any, type: 'review', data });

    expect(provider.calls.send).toHaveLength(1);
    expect(repo.calls.markSent[0]).toMatchObject({ appointment_id: 'a1', type: 'review' });
  });
});
