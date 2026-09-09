import { describe, it, expect } from 'vitest';
import { NexiProvider } from './nexi';

// MAC attesi precalcolati (SHA1) per input noti — asserzione black-box.
const REQ_MAC = 'f9afb3298a6ca109464344893b25a18fdc467d33';
const NOTIF_MAC = '46904fd922ddc3699bbbeba5dc3113059ef4e0de';

function makeProvider() {
  return new NexiProvider({
    alias: 'ALIAS_TEST',
    macKey: 'SECRET123',
    env: 'test',
    genCodTrans: () => 'ORDER1',
  });
}

describe('NexiProvider.createCheckout', () => {
  it('costruisce una POST verso il DispatcherServlet di test con i campi giusti', async () => {
    const res = await makeProvider().createCheckout({
      amountCents: 2500,
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/ko',
    });

    expect(res.method).toBe('POST');
    expect(res.url).toBe('https://int-ecommerce.nexi.it/ecomm/ecomm/DispatcherServlet');
    expect(res.providerRef).toBe('ORDER1');
    expect(res.fields!.alias).toBe('ALIAS_TEST');
    expect(res.fields!.importo).toBe('2500');
    expect(res.fields!.divisa).toBe('EUR');
    expect(res.fields!.codTrans).toBe('ORDER1');
    expect(res.fields!.url).toBe('https://app/ok');
    expect(res.fields!.url_back).toBe('https://app/ko');
  });

  it('firma la richiesta col MAC SHA1 secondo la formula Nexi', async () => {
    const res = await makeProvider().createCheckout({
      amountCents: 2500,
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/ko',
    });
    expect(res.fields!.mac).toBe(REQ_MAC);
  });

  it('include urlpost quando e\' fornito notifyUrl', async () => {
    const res = await makeProvider().createCheckout({
      amountCents: 2500,
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/ko',
      notifyUrl: 'https://app/notify',
    });
    expect(res.fields!.urlpost).toBe('https://app/notify');
  });
});

describe('NexiProvider.verifyWebhook', () => {
  const goodBody = new URLSearchParams({
    codTrans: 'ORDER1', esito: 'OK', importo: '2500', divisa: 'EUR',
    data: '20260905', orario: '101500', codAut: '123456', mac: NOTIF_MAC,
  }).toString();

  it('accetta una notifica con MAC valido e la normalizza come "succeeded"', () => {
    const ev = makeProvider().verifyWebhook(goodBody, '');
    expect(ev.providerRef).toBe('ORDER1');
    expect(ev.amountCents).toBe(2500);
    expect(ev.status).toBe('succeeded');
  });

  it('lancia se il MAC della notifica non e\' valido', () => {
    const badBody = goodBody.replace(NOTIF_MAC, 'deadbeef');
    expect(() => makeProvider().verifyWebhook(badBody, '')).toThrow();
  });

  it('mappa esito ANNULLO come "canceled"', () => {
    // MAC non verificabile qui: usiamo un provider senza chiave che salta la verifica non e' possibile,
    // quindi calcoliamo il caso valido tramite un annullo con MAC corretto.
    const body = new URLSearchParams({
      codTrans: 'ORDER1', esito: 'ANNULLO', importo: '2500', divisa: 'EUR',
      data: '20260905', orario: '101500', codAut: '',
    });
    // firma coerente con la formula
    const crypto = require('crypto');
    const mac = crypto.createHash('sha1')
      .update('codTrans=ORDER1esito=ANNULLOimporto=2500divisa=EURdata=20260905orario=101500codAut=SECRET123')
      .digest('hex');
    body.set('mac', mac);
    const ev = makeProvider().verifyWebhook(body.toString(), '');
    expect(ev.status).toBe('canceled');
  });
});
