export interface BasketLine { description: string; quantity: number; unitPriceCents: number; discountCents: number }
export interface Basket { lines: BasketLine[]; amountCents: number }
export function parseBasket(value: unknown): Basket {
  if (!Array.isArray(value) || !value.length || value.length > 30) throw new Error('Inserisci da 1 a 30 voci');
  const lines: BasketLine[] = value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Voce non valida');
    const { description, quantity, unitPriceCents, discountCents } = raw as Record<string, unknown>;
    if (typeof description !== 'string' || !description.trim() || description.trim().length > 120 || /[\x00-\x1f]/.test(description)) throw new Error('Descrizione non valida');
    if (!Number.isSafeInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 99 || !Number.isSafeInteger(unitPriceCents) || (unitPriceCents as number) < 0 || (unitPriceCents as number) > 1000000 || !Number.isSafeInteger(discountCents) || (discountCents as number) < 0 || (discountCents as number) > (quantity as number) * (unitPriceCents as number)) throw new Error('Quantita, prezzo o sconto non validi');
    return { description: description.trim(), quantity: quantity as number, unitPriceCents: unitPriceCents as number, discountCents: discountCents as number };
  });
  const amountCents = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents - line.discountCents, 0);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 10000000) throw new Error('Il totale deve essere positivo e non superare 100.000 euro');
  return { lines, amountCents };
}
export function euroInput(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized)) throw new Error('Importo non valido');
  const [whole, decimal = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}
export function buildSalonReceipt(basket: Basket, number: string, vatPercent: number, method: 'cash' | 'card') {
  const verified = parseBasket(basket.lines);
  if (!Number.isInteger(vatPercent) || vatPercent < 1 || vatPercent > 99 || !/^TEST-[0-9A-F]{15}$/.test(number)) throw new Error('Configurazione fiscale TEST non valida');
  const money = (cents: number) => (cents / 100).toFixed(2);
  let totalNet = 0;
  const entries = verified.lines.filter(line => line.quantity * line.unitPriceCents > line.discountCents).map(line => {
    const gross = line.quantity * line.unitPriceCents - line.discountCents;
    const net = Math.round(gross * 100 / (100 + vatPercent)); totalNet += net;
    const vat = { type: 'VAT_RATE', code: 'STANDARD', percentage: vatPercent.toFixed(2), exclusive: money(net), inclusive: money(gross), amount: money(gross - net) };
    const text = `${line.quantity > 1 ? line.quantity + ' x ' : ''}${line.description}${line.discountCents ? ' (sconto EUR ' + money(line.discountCents) + ')' : ''}`;
    return { type: 'SALE', details: { concept: 'SERVICE' }, data: { type: 'ITEM', text, unit: { quantity: '1.00', price: { inclusive: vat.inclusive, exclusive: vat.exclusive } }, value: { base: vat.exclusive, discount: '0.00' }, vat } };
  });
  const vat = { type: 'VAT_RATE', code: 'STANDARD', percentage: vatPercent.toFixed(2), exclusive: money(totalNet), inclusive: money(verified.amountCents), amount: money(verified.amountCents - totalNet) };
  const payment = method === 'cash' ? { type: 'CASH', details: { amount: vat.inclusive } } : { type: 'CARD', kind: 'CREDIT', number: '****', details: { amount: vat.inclusive } };
  return { type: 'RECEIPT', document: { number }, entries, breakdown: [vat], totals: { vat: { amount: vat.amount, exclusive: vat.exclusive, inclusive: vat.inclusive } }, payments: [payment] };
}
