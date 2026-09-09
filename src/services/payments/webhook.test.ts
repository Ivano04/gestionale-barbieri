import { describe, it, expect } from 'vitest';
import { applyWebhookEvent, confirmBookingFromPayment } from './webhook';
import type { WebhookEvent } from './types';

function makeFakeRepo(row: any = null) {
  const calls: any = { updateByProviderRef: [] };
  return {
    calls,
    insertPending: async () => ({ id: 'x' }),
    updateByProviderRef: async (ref: string, patch: any) => { calls.updateByProviderRef.push({ ref, patch }); },
    getByProviderRef: async () => row,
  };
}

const succeeded: WebhookEvent = {
  type: 'checkout.session.completed',
  providerRef: 'ref_123',
  amountCents: 2500,
  status: 'succeeded',
  raw: {},
};

describe('applyWebhookEvent', () => {
  it('aggiorna la riga corrispondente al riferimento con il nuovo stato', async () => {
    const repo = makeFakeRepo();

    await applyWebhookEvent({ repo: repo as any, event: succeeded });

    expect(repo.calls.updateByProviderRef).toHaveLength(1);
    expect(repo.calls.updateByProviderRef[0].ref).toBe('ref_123');
    expect(repo.calls.updateByProviderRef[0].patch.status).toBe('succeeded');
  });

  it('ignora gli eventi ancora "pending" senza scrivere nulla', async () => {
    const repo = makeFakeRepo();

    await applyWebhookEvent({ repo: repo as any, event: { ...succeeded, status: 'pending' } });

    expect(repo.calls.updateByProviderRef).toHaveLength(0);
  });
});

describe('confirmBookingFromPayment', () => {
  const bookingMeta = { booking: { salon_id: 's1', service_id: 'svc', stylist_id: 'st', start_time: 't', client: {} } };

  function makeCreateAppointment() {
    const calls: any[] = [];
    const fn = async (booking: any) => { calls.push(booking); return { id: 'appt_1' }; };
    return Object.assign(fn, { calls });
  }

  it('a pagamento riuscito crea l\'appuntamento e lo collega al pagamento', async () => {
    const repo = makeFakeRepo({ id: 'pay_1', appointment_id: null, status: 'succeeded', metadata: bookingMeta });
    const createAppointment = makeCreateAppointment();

    await confirmBookingFromPayment({ repo: repo as any, event: succeeded, createAppointment });

    expect(createAppointment.calls).toHaveLength(1);
    expect(createAppointment.calls[0]).toEqual(bookingMeta.booking);
    expect(repo.calls.updateByProviderRef[0].patch.appointment_id).toBe('appt_1');
  });

  it('e\' idempotente: se l\'appuntamento esiste gia\' non lo ricrea', async () => {
    const repo = makeFakeRepo({ id: 'pay_1', appointment_id: 'appt_existing', status: 'succeeded', metadata: bookingMeta });
    const createAppointment = makeCreateAppointment();

    await confirmBookingFromPayment({ repo: repo as any, event: succeeded, createAppointment });

    expect(createAppointment.calls).toHaveLength(0);
  });

  it('non crea nulla se l\'evento non e\' "succeeded"', async () => {
    const repo = makeFakeRepo({ id: 'pay_1', appointment_id: null, status: 'failed', metadata: bookingMeta });
    const createAppointment = makeCreateAppointment();

    await confirmBookingFromPayment({ repo: repo as any, event: { ...succeeded, status: 'failed' }, createAppointment });

    expect(createAppointment.calls).toHaveLength(0);
  });

  it('non crea nulla se il pagamento non ha una prenotazione nei metadata', async () => {
    const repo = makeFakeRepo({ id: 'pay_1', appointment_id: null, status: 'succeeded', metadata: {} });
    const createAppointment = makeCreateAppointment();

    await confirmBookingFromPayment({ repo: repo as any, event: succeeded, createAppointment });

    expect(createAppointment.calls).toHaveLength(0);
  });
});
