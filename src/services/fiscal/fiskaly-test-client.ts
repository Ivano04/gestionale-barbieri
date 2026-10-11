import { randomUUID } from 'node:crypto';

export const FISKALY_TEST_URL = 'https://test.api.fiskaly.com';
export const FISKALY_API_VERSION = '2026-06-01';

export interface FiskalyTestConfig {
  apiKey: string;
  apiSecret: string;
  systemId?: string;
}
export interface FiskalyRecord {
  content: {
    id: string;
    type?: string;
    state?: string;
    mode?: string;
    compliance?: { data?: string; url?: string; artifact?: unknown };
    [key: string]: unknown;
  };
}

export function fiskalyTestConfigFromEnv(env: Record<string, string | undefined> = process.env): FiskalyTestConfig {
  if (env.FISKALY_ENV !== 'test') throw new Error('Impostare FISKALY_ENV=test. LIVE non supportato da questa prova.');
  if (env.FISKALY_API_BASE_URL && env.FISKALY_API_BASE_URL !== FISKALY_TEST_URL) {
    throw new Error('La prova accetta esclusivamente https://test.api.fiskaly.com.');
  }
  const apiKey = env.FISKALY_API_KEY?.trim();
  const apiSecret = env.FISKALY_API_SECRET?.trim();
  if (!apiKey || !apiSecret) throw new Error('Configurare FISKALY_API_KEY e FISKALY_API_SECRET TEST sul server.');
  return { apiKey, apiSecret, systemId: env.FISKALY_SYSTEM_ID?.trim() || undefined };
}

export class FiskalyTestError extends Error {
  status: number | null;
  uncertain: boolean;
  constructor(message: string, status: number | null, uncertain: boolean) {
    super(message);
    this.name = 'FiskalyTestError';
    this.status = status;
    this.uncertain = uncertain;
  }
}

function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('Identificativo o chiave di idempotenza non valido: serve un UUID.');
  }
  return value;
}

// Client isolato: nessun accesso a Supabase, Nexi, Resend o all'ambiente LIVE.
// Non ritenta automaticamente le scritture: il chiamante deve riutilizzare la stessa chiave.
export class FiskalyTestClient {
  private config: FiskalyTestConfig;
  private fetcher: typeof fetch;
  private token?: { bearer: string; expiresAt: number; organizationId?: string };

  constructor(config: FiskalyTestConfig, fetcher: typeof fetch = fetch) {
    if (!config.apiKey?.trim() || !config.apiSecret?.trim()) throw new Error('Credenziali fiskaly mancanti.');
    this.config = config;
    this.fetcher = fetcher;
  }

  private async request(path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown, key?: string, bearer?: string): Promise<unknown> {
    const headers: Record<string, string> = { 'X-Api-Version': FISKALY_API_VERSION };
    if (method !== 'GET') {
      if (!key) throw new Error('Chiave di idempotenza obbligatoria.');
      headers['X-Idempotency-Key'] = uuid(key);
      headers['Content-Type'] = 'application/json';
    }
    if (method === 'PATCH') headers['Content-Type'] = 'application/json';
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    let response: Response;
    try {
      response = await this.fetcher(FISKALY_TEST_URL + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000), redirect: 'error', cache: 'no-store',
      });
    } catch {
      throw new FiskalyTestError('Connessione fiskaly interrotta. Riprendere con la stessa chiave; non avviare una nuova emissione.', null, method !== 'GET');
    }
    if (!response.ok) {
      let detail = '';
      try {
        const errorBody = await response.json() as Record<string, unknown>;
        // Stampare soltanto campi diagnostici, mai la risposta completa.
        const safe = (value: unknown): string => {
          if (typeof value !== 'string') return '';
          let message = value;
          const sensitive = [this.config.apiKey, this.config.apiSecret, bearer,
            'MySecurePassword123', '1234567890', '12345678901', 'RSSMRA85M01H501Z'];
          for (const secret of sensitive) {
            if (secret) message = message.split(secret).join('[redacted]');
          }
          return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
            .replace(/[\r\n\t]/g, ' ').slice(0, 500);
        };
        const fields: string[] = [];
        const walk = (node: unknown, depth = 0): void => {
          if (depth > 6 || fields.length >= 12 || !node || typeof node !== 'object') return;
          if (Array.isArray(node)) { node.slice(0, 12).forEach(value => walk(value, depth + 1)); return; }
          for (const [name, value] of Object.entries(node)) {
            if (['code', 'message', 'description', 'detail', 'title', 'reason'].includes(name)) {
              const text = safe(value);
              if (text) fields.push(name + ': ' + text);
            } else if (['error', 'errors', 'content', 'validations', 'violations', 'logs'].includes(name)) {
              walk(value, depth + 1);
            }
          }
        };
        walk(errorBody);
        detail = ' ' + method + ' ' + path + ': ' + (fields.length ? fields.join(' | ') :
          'Campi risposta: ' + Object.keys(errorBody).filter(name => /^[a-z_]{1,40}$/i.test(name)).join(', '));
      } catch { /* Risposta non JSON: mantenere il messaggio generico. */ }
      throw new FiskalyTestError('fiskaly HTTP ' + response.status + '.' +
        (detail || ' Consultare HUB per i dettagli.'), response.status, method !== 'GET' && response.status >= 500);
    }
    try {
      return await response.json();
    } catch {
      throw new FiskalyTestError('Risposta fiskaly non leggibile. Verificare l’esito prima di ripetere.', response.status, method !== 'GET');
    }
  }

  async authenticate(): Promise<void> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return;
    const result = await this.request('/tokens', 'POST', {
      content: { type: 'API_KEY', key: this.config.apiKey, secret: this.config.apiSecret },
    }, randomUUID()) as { content?: { authentication?: { bearer?: string; expires_at?: string }; organization?: { id?: string } } };
    const auth = result.content?.authentication;
    const expiresAt = Date.parse(auth?.expires_at || '');
    if (!auth?.bearer || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new FiskalyTestError('Risposta di autenticazione fiskaly non valida.', null, false);
    }
    this.token = { bearer: auth.bearer, expiresAt, organizationId: result.content?.organization?.id };
  }


  async assertOrganization(id: string): Promise<void> {
    uuid(id);
    await this.authenticate();
    if (this.token!.organizationId !== id) {
      throw new Error('Le credenziali non appartengono alla Unit prevista. Nessuna risorsa creata.');
    }
  }

  async createTestTaxpayer(organizationId: string, content: Record<string, unknown>, key: string): Promise<FiskalyRecord> {
    uuid(key);
    await this.assertOrganization(organizationId);
    return await this.request('/taxpayers', 'POST', { content }, key, this.token!.bearer) as FiskalyRecord;
  }

  async getTaxpayer(organizationId: string, id: string): Promise<FiskalyRecord> {
    uuid(id);
    await this.assertOrganization(organizationId);
    return await this.request('/taxpayers/' + id, 'GET', undefined, undefined, this.token!.bearer) as FiskalyRecord;
  }

  async commissionTaxpayer(organizationId: string, id: string, key: string): Promise<FiskalyRecord> {
    uuid(key);
    const current = await this.getTaxpayer(organizationId, id);
    if (current.content?.id !== id) throw new Error('Identificativo Taxpayer inatteso.');
    if (current.content.state !== 'COMMISSIONED') {
      if (current.content.state !== 'ACQUIRED') throw new Error('Stato Taxpayer non attivabile: verificare in HUB.');
      await this.request('/taxpayers/' + id, 'PATCH', {
        content: { state: 'COMMISSIONED' },
      }, key, this.token!.bearer);
    }
    const verified = await this.getTaxpayer(organizationId, id);
    if (verified.content?.id !== id || verified.content.state !== 'COMMISSIONED' || verified.content.mode !== 'OPERATIVE') {
      throw new Error('Attivazione non ancora confermata: rieseguire commission per verificare lo stato.');
    }
    return verified;
  }
  async getLocation(organizationId: string, id: string): Promise<FiskalyRecord> {
    uuid(id);
    await this.assertOrganization(organizationId);
    return await this.request('/locations/' + id, 'GET', undefined, undefined, this.token!.bearer) as FiskalyRecord;
  }

  async createTestSystem(organizationId: string, locationId: string, key: string): Promise<FiskalyRecord> {
    uuid(key);
    const location = await this.getLocation(organizationId, locationId);
    if (location.content?.id !== locationId || location.content.state !== 'COMMISSIONED' ||
        location.content.mode !== 'OPERATIVE') throw new Error('La sede TEST deve essere attiva prima di creare il sistema.');
    return await this.request('/systems', 'POST', { content: {
      type: 'FISCAL_DEVICE', location: { id: locationId },
      producer: { type: 'MPN', number: 'LOCALVISTA-TEST-001', details: { name: 'LocalVista TEST' } },
      software: { name: 'LocalVista', version: '0.1.0' },
    } }, key, this.token!.bearer) as FiskalyRecord;
  }

  async getTestSystem(organizationId: string, id: string): Promise<FiskalyRecord> {
    uuid(id);
    await this.assertOrganization(organizationId);
    return await this.request('/systems/' + id, 'GET', undefined, undefined, this.token!.bearer) as FiskalyRecord;
  }
  async commissionSystem(organizationId: string, id: string, key: string): Promise<FiskalyRecord> {
    uuid(key);
    const current = await this.getTestSystem(organizationId, id);
    if (current.content?.id !== id) throw new Error('Identificativo System inatteso.');
    if (current.content.state !== 'COMMISSIONED') {
      if (current.content.state !== 'ACQUIRED') throw new Error('Stato System non attivabile.');
      await this.request('/systems/' + id, 'PATCH', { content: { state: 'COMMISSIONED' } }, key, this.token!.bearer);
    }
    const verified = await this.getTestSystem(organizationId, id);
    if (verified.content?.id !== id || verified.content.state !== 'COMMISSIONED' || verified.content.mode !== 'OPERATIVE') {
      throw new Error('Attivazione System non ancora confermata: riprendere commission con la stessa sessione.');
    }
    return verified;
  }
  async getSystem(): Promise<FiskalyRecord> {
    if (!this.config.systemId) throw new Error('Configurare FISKALY_SYSTEM_ID dell’esercente TEST.');
    await this.authenticate();
    return await this.request('/systems/' + uuid(this.config.systemId), 'GET', undefined, undefined, this.token!.bearer) as FiskalyRecord;
  }

  async getRecord(id: string): Promise<FiskalyRecord> {
    uuid(id);
    await this.authenticate();
    return await this.request('/records/' + id, 'GET', undefined, undefined, this.token!.bearer) as FiskalyRecord;
  }

  async createIntention(key: string): Promise<FiskalyRecord> {
    uuid(key);
    const system = await this.getSystem();
    if (system.content?.state !== 'COMMISSIONED') throw new Error('Il sistema TEST deve essere COMMISSIONED prima della prova.');
    return await this.request('/records', 'POST', {
      content: { type: 'INTENTION', system: { id: this.config.systemId }, operation: { type: 'TRANSACTION' } },
    }, key, this.token!.bearer) as FiskalyRecord;
  }

  async submitReceipt(intentionId: string, operation: Record<string, unknown>, key: string): Promise<FiskalyRecord> {
    uuid(intentionId);
    uuid(key);
    if (operation.type !== 'RECEIPT') throw new Error('Questa prova accetta solo operazioni RECEIPT.');
    await this.authenticate();
    return await this.request('/records', 'POST', {
      content: { type: 'TRANSACTION', record: { id: intentionId }, operation },
    }, key, this.token!.bearer) as FiskalyRecord;
  }
}
