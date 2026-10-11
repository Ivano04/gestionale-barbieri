import { describe, expect, it, vi } from 'vitest';
import { FiskalyTestClient, fiskalyTestConfigFromEnv, FISKALY_TEST_URL } from './fiskaly-test-client';

const key = '10000000-0000-4000-8000-000000000001';
const systemId = '10000000-0000-4000-8000-000000000002';
const intentionId = '10000000-0000-4000-8000-000000000003';
const config = { apiKey: 'test-key', apiSecret: 'test-secret', systemId };
const auth = () => Response.json({ content: { authentication: {
  bearer: 'secret-token', expires_at: new Date(Date.now() + 3600000).toISOString(),
} } });
const mockFetch = () => vi.fn<typeof fetch>();

describe('configurazione TEST', () => {
  it('rifiuta LIVE e URL alternativi prima di chiamare il provider', () => {
    expect(() => fiskalyTestConfigFromEnv({ FISKALY_ENV: 'live' })).toThrow(/LIVE/);
    expect(() => fiskalyTestConfigFromEnv({ FISKALY_ENV: 'test', FISKALY_API_BASE_URL: 'https://live.api.fiskaly.com' })).toThrow(/esclusivamente/);
    expect(() => fiskalyTestConfigFromEnv({ FISKALY_ENV: 'test' })).toThrow(/API_KEY/);
  });
});

describe('client fiskaly isolato', () => {
  it('autentica su TEST e riusa il token senza esporlo', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(auth());
    const client = new FiskalyTestClient(config, fetcher);
    expect(await client.authenticate()).toBeUndefined();
    await client.authenticate();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(FISKALY_TEST_URL + '/tokens');
    expect(JSON.parse(options!.body as string)).toEqual({ content: { type: 'API_KEY', key: config.apiKey, secret: config.apiSecret } });
    expect(options!.redirect).toBe('error');
  });

  it('rifiuta un sistema non configurato per emettere', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(auth()).mockResolvedValueOnce(Response.json({ content: { id: systemId, state: 'ACQUIRED' } }));
    await expect(new FiskalyTestClient(config, fetcher).createIntention(key)).rejects.toThrow(/COMMISSIONED/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('non ritenta una scrittura incerta e mantiene la chiave alla ripresa', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(auth())
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(Response.json({ content: { id: intentionId } }));
    const client = new FiskalyTestClient(config, fetcher);
    await expect(client.submitReceipt(intentionId, { type: 'RECEIPT' }, key)).rejects.toMatchObject({ uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await client.submitReceipt(intentionId, { type: 'RECEIPT' }, key);
    const first = fetcher.mock.calls[1][1];
    const resumed = fetcher.mock.calls[2][1];
    expect(first!.headers).toEqual(resumed!.headers);
    expect(first!.body).toBe(resumed!.body);
    expect((first!.headers as Record<string, string>)['X-Idempotency-Key']).toBe(key);
  });

  it('classifica errori HTTP senza divulgare risposta o segreti', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(auth())
      .mockResolvedValueOnce(new Response('test-secret secret-token personal-data', { status: 400 }));
    await expect(new FiskalyTestClient(config, fetcher).submitReceipt(intentionId, { type: 'RECEIPT' }, key))
      .rejects.toMatchObject({ status: 400, uncertain: false, message: 'fiskaly HTTP 400. Consultare HUB per i dettagli.' });
  });

  it('classifica una risposta POST illeggibile come incerta', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response('invalid', { status: 201 }));
    await expect(new FiskalyTestClient(config, fetcher).submitReceipt(intentionId, { type: 'RECEIPT' }, key)).rejects.toMatchObject({ uncertain: true });
  });

  it('blocca ID e operazioni non ammesse prima delle chiamate', async () => {
    const fetcher = mockFetch();
    const client = new FiskalyTestClient(config, fetcher);
    await expect(client.getRecord('../tokens')).rejects.toThrow(/UUID/);
    await expect(client.submitReceipt(intentionId, { type: 'CANCELLATION' }, key)).rejects.toThrow(/RECEIPT/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Taxpayer TEST e organizzazione', () => {
  const organizationId = 'd8598896-5164-44c0-8ffa-482e72e69b8a';
  const unitAuth = () => Response.json({ content: { organization: { id: organizationId },
    authentication: { bearer: 'secret-token', expires_at: new Date(Date.now() + 3600000).toISOString() } } });
  it('blocca una chiave di un altro gruppo prima della creazione', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(auth());
    await expect(new FiskalyTestClient(config, fetcher).createTestTaxpayer(organizationId, { type: 'COMPANY' }, key))
      .rejects.toThrow(/Unit prevista/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('crea nella Unit verificata con chiave stabile e recupera il Taxpayer', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(unitAuth())
      .mockResolvedValueOnce(Response.json({ content: { id: intentionId, state: 'ACQUIRED' } }))
      .mockResolvedValueOnce(Response.json({ content: { id: intentionId, state: 'ACQUIRED' } }));
    const client = new FiskalyTestClient(config, fetcher);
    await client.createTestTaxpayer(organizationId, { type: 'COMPANY' }, key);
    await client.getTaxpayer(organizationId, intentionId);
    expect(fetcher.mock.calls[1][0]).toBe(FISKALY_TEST_URL + '/taxpayers');
    expect((fetcher.mock.calls[1][1]!.headers as Record<string, string>)['X-Idempotency-Key']).toBe(key);
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ content: { type: 'COMPANY' } });
    expect(fetcher.mock.calls[2][0]).toBe(FISKALY_TEST_URL + '/taxpayers/' + intentionId);
  });
});

describe('attivazione Taxpayer', () => {
  const organizationId = 'd8598896-5164-44c0-8ffa-482e72e69b8a';
  const token = () => Response.json({ content: { organization: { id: organizationId },
    authentication: { bearer: 'token', expires_at: new Date(Date.now() + 3600000).toISOString() } } });
  const resource = (state: string, mode: string) => Response.json({ content: { id: intentionId, state, mode } });
  it('attiva e conferma con una lettura successiva', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(token())
      .mockResolvedValueOnce(resource('ACQUIRED', 'INACTIVE'))
      .mockResolvedValueOnce(resource('COMMISSIONED', 'OPERATIVE'))
      .mockResolvedValueOnce(resource('COMMISSIONED', 'OPERATIVE'));
    const result = await new FiskalyTestClient(config, fetcher).commissionTaxpayer(organizationId, intentionId, key);
    expect(result.content.mode).toBe('OPERATIVE');
    expect(fetcher.mock.calls[2][1]!.method).toBe('PATCH');
    expect((fetcher.mock.calls[2][1]!.headers as Record<string, string>)['X-Idempotency-Key']).toBe(key);
    expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ content: { state: 'COMMISSIONED' } });
  });
  it('alla ripresa non ripete PATCH se il Taxpayer e gia attivo', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(token())
      .mockResolvedValueOnce(resource('COMMISSIONED', 'OPERATIVE'))
      .mockResolvedValueOnce(resource('COMMISSIONED', 'OPERATIVE'));
    await new FiskalyTestClient(config, fetcher).commissionTaxpayer(organizationId, intentionId, key);
    expect(fetcher.mock.calls.some(([, options]) => options!.method === 'PATCH')).toBe(false);
  });
  it('classifica il timeout PATCH come esito incerto senza ritentare', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(token())
      .mockResolvedValueOnce(resource('ACQUIRED', 'INACTIVE'))
      .mockRejectedValueOnce(new Error('timeout'));
    await expect(new FiskalyTestClient(config, fetcher).commissionTaxpayer(organizationId, intentionId, key))
      .rejects.toMatchObject({ uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('non dichiara successo se il modo rimane inattivo', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(token())
      .mockResolvedValueOnce(resource('COMMISSIONED', 'INACTIVE'))
      .mockResolvedValueOnce(resource('COMMISSIONED', 'INACTIVE'));
    await expect(new FiskalyTestClient(config, fetcher).commissionTaxpayer(organizationId, intentionId, key))
      .rejects.toThrow(/non ancora confermata/);
  });
});
describe('attivazione System TEST', () => {
  const organizationId = 'd8598896-5164-44c0-8ffa-482e72e69b8a';
  const token = () => Response.json({ content: { organization: { id: organizationId },
    authentication: { bearer: 'token', expires_at: new Date(Date.now() + 3600000).toISOString() } } });
  const resource = (state: string, mode: string) => Response.json({ content: { id: systemId, state, mode } });
  it('attiva con chiave di idempotenza e verifica lo stato remoto', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(token())
      .mockResolvedValueOnce(resource('ACQUIRED', 'INACTIVE'))
      .mockResolvedValueOnce(resource('COMMISSIONED', 'OPERATIVE'))
      .mockResolvedValueOnce(resource('COMMISSIONED', 'OPERATIVE'));
    await new FiskalyTestClient(config, fetcher).commissionSystem(organizationId, systemId, key);
    expect(fetcher.mock.calls[2][0]).toBe(FISKALY_TEST_URL + '/systems/' + systemId);
    expect(fetcher.mock.calls[2][1]!.method).toBe('PATCH');
    expect((fetcher.mock.calls[2][1]!.headers as Record<string, string>)['X-Idempotency-Key']).toBe(key);
  });
  it('riprende un sistema gia attivo senza ripetere PATCH', async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(token())
      .mockResolvedValueOnce(resource('COMMISSIONED', 'OPERATIVE'))
      .mockResolvedValueOnce(resource('COMMISSIONED', 'OPERATIVE'));
    await new FiskalyTestClient(config, fetcher).commissionSystem(organizationId, systemId, key);
    expect(fetcher.mock.calls.some(([, options]) => options!.method === 'PATCH')).toBe(false);
  });
});