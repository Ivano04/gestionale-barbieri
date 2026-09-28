import { describe, it, expect } from 'vitest';
import { ResendProvider } from './resend';

function makeFakeResend(result: any = { data: { id: 'email_1' }, error: null }) {
  const calls: any = { send: [] };
  return {
    calls,
    emails: {
      send: async (params: any) => { calls.send.push(params); return result; },
    },
  };
}

describe('ResendProvider.send', () => {
  it('invia con mittente configurato e restituisce l\'id del messaggio', async () => {
    const resend = makeFakeResend();
    const provider = new ResendProvider(resend as any, 'Salone <noreply@salone.it>');

    const res = await provider.send({ to: 'c@x.it', subject: 'Ciao', html: '<p>ciao</p>' });

    const sent = resend.calls.send[0];
    expect(sent.from).toBe('Salone <noreply@salone.it>');
    expect(sent.to).toBe('c@x.it');
    expect(sent.subject).toBe('Ciao');
    expect(sent.html).toBe('<p>ciao</p>');
    expect(res.id).toBe('email_1');
  });

  it('lancia se Resend restituisce un errore', async () => {
    const resend = makeFakeResend({ data: null, error: { message: 'dominio non verificato' } });
    const provider = new ResendProvider(resend as any, 'x@y.it');

    await expect(provider.send({ to: 'c@x.it', subject: 's', html: 'h' })).rejects.toThrow(/dominio non verificato/);
  });
});
