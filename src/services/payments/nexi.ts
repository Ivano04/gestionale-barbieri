import { createHash, randomBytes } from 'crypto';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  PaymentProvider,
  PaymentStatus,
  WebhookEvent,
} from './types';

// Adattatore Nexi XPay "Pagamento Semplice" (hosted payment page classica).
// Specifiche ufficiali (v20.2):
//   - Avvio: POST form verso il DispatcherServlet, importo in centesimi, divisa EUR.
//     MAC = SHA1("codTrans=<x>divisa=<x>importo=<x><chiaveSegreta>")
//   - Esito/notifica: POST x-www-form-urlencoded, va risposto HTTP 200.
//     MAC = SHA1("codTrans=<x>esito=<x>importo=<x>divisa=<x>data=<x>orario=<x>codAut=<x><chiaveSegreta>")

const ENDPOINTS = {
  test: 'https://int-ecommerce.nexi.it/ecomm/ecomm/DispatcherServlet',
  live: 'https://ecommerce.nexi.it/ecomm/ecomm/DispatcherServlet',
} as const;

// API back office Storno/Rimborso (server-to-server, JSON): annulla o rimborsa
// in base allo stato della transazione.
const STORNA_ENDPOINTS = {
  test: 'https://int-ecommerce.nexi.it/ecomm/api/bo/storna',
  live: 'https://ecommerce.nexi.it/ecomm/api/bo/storna',
} as const;

export interface NexiConfig {
  alias: string;
  macKey: string;
  env: 'test' | 'live';
  /** Generatore del codTrans univoco (iniettabile per i test) */
  genCodTrans?: () => string;
  /** fetch iniettabile (per i test); default: fetch globale */
  fetchImpl?: typeof fetch;
  /** Orologio iniettabile (per i test); default: Date.now */
  nowMs?: () => number;
}

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

function mapEsitoToStatus(esito: string): PaymentStatus {
  switch (esito.toUpperCase()) {
    case 'OK':
      return 'succeeded';
    case 'ANNULLO':
      return 'canceled';
    case 'KO':
    case 'ERRORE':
      return 'failed';
    default:
      return 'pending';
  }
}

// codTrans: alfanumerico, univoco, MAX 30 caratteri, esclusi # ' "
function defaultCodTrans(): string {
  return ('TX' + Date.now().toString(36) + randomBytes(4).toString('hex')).slice(0, 30);
}

export class NexiProvider implements PaymentProvider {
  private readonly genCodTrans: () => string;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;

  constructor(private readonly config: NexiConfig) {
    this.genCodTrans = config.genCodTrans ?? defaultCodTrans;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.nowMs = config.nowMs ?? Date.now;
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const codTrans = this.genCodTrans();
    const importo = String(params.amountCents);
    const divisa = (params.currency ?? 'EUR').toUpperCase();

    const mac = sha1(`codTrans=${codTrans}divisa=${divisa}importo=${importo}${this.config.macKey}`);

    const fields: Record<string, string> = {
      alias: this.config.alias,
      importo,
      divisa,
      codTrans,
      url: params.successUrl,
      url_back: params.cancelUrl,
      mac,
    };
    if (params.notifyUrl) fields.urlpost = params.notifyUrl;

    return {
      url: ENDPOINTS[this.config.env],
      providerRef: codTrans,
      method: 'POST',
      fields,
    };
  }

  verifyWebhook(rawBody: string, _signature: string): WebhookEvent {
    const p = new URLSearchParams(rawBody);
    const codTrans = p.get('codTrans') ?? '';
    const esito = p.get('esito') ?? '';
    const importo = p.get('importo') ?? '';
    const divisa = p.get('divisa') ?? '';
    const data = p.get('data') ?? '';
    const orario = p.get('orario') ?? '';
    const codAut = p.get('codAut') ?? '';
    const providedMac = (p.get('mac') ?? '').toLowerCase();

    const expected = sha1(
      `codTrans=${codTrans}esito=${esito}importo=${importo}divisa=${divisa}` +
        `data=${data}orario=${orario}codAut=${codAut}${this.config.macKey}`,
    );
    if (providedMac !== expected) {
      throw new Error('MAC notifica Nexi non valido');
    }

    return {
      type: `nexi.${esito.toLowerCase() || 'notification'}`,
      providerRef: codTrans,
      amountCents: importo ? parseInt(importo, 10) : null,
      status: mapEsitoToStatus(esito),
      raw: Object.fromEntries(p.entries()),
    };
  }

  // Storno/Rimborso via API back office XPay: POST /ecomm/api/bo/storna (JSON).
  // Annulla o rimborsa automaticamente in base allo stato della transazione.
  // providerRef = codiceTransazione (il nostro codTrans). importo obbligatorio.
  //   MAC = SHA1("apiKey=<>codiceTransazione=<>divisa=<>importo=<>timeStamp=<><chiaveSegreta>")
  //   divisa = 978 (codice numerico EUR).
  async refund(codiceTransazione: string, amountCents?: number): Promise<void> {
    if (amountCents == null) {
      throw new Error('Rimborso Nexi: importo obbligatorio');
    }
    const importo = String(amountCents);
    const divisa = '978';
    const timeStamp = String(this.nowMs());
    const mac = sha1(
      `apiKey=${this.config.alias}codiceTransazione=${codiceTransazione}` +
        `divisa=${divisa}importo=${importo}timeStamp=${timeStamp}${this.config.macKey}`,
    );

    const res = await this.fetchImpl(STORNA_ENDPOINTS[this.config.env], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: this.config.alias, codiceTransazione, importo, divisa, timeStamp, mac }),
    });
    const data: any = await res.json();
    if (data?.esito !== 'OK') {
      throw new Error(`Storno Nexi fallito: ${data?.errore?.messaggio || data?.esito || 'sconosciuto'}`);
    }
  }
}
