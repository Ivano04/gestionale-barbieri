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

export interface NexiConfig {
  alias: string;
  macKey: string;
  env: 'test' | 'live';
  /** Generatore del codTrans univoco (iniettabile per i test) */
  genCodTrans?: () => string;
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

  constructor(private readonly config: NexiConfig) {
    this.genCodTrans = config.genCodTrans ?? defaultCodTrans;
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

  async refund(_providerRef: string, _amountCents?: number): Promise<void> {
    // L'XPay classico rimborsa tramite l'API di storno (endpoint separato).
    // Per ora si opera dal back office Nexi; l'implementazione verra' aggiunta poi.
    throw new Error('Rimborso Nexi non ancora implementato (usare il back office)');
  }
}
