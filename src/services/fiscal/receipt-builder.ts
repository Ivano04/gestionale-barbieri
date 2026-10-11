export function buildTestReceipt(amountCents: number, name: string, number: string, vatPercent: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 ||
      !Number.isInteger(vatPercent) || vatPercent <= 0 || vatPercent > 99) throw new Error('Invalid TEST receipt amount or VAT');
  if (!/^[0-9A-Z_/.-]{1,20}$/.test(number)) throw new Error('Invalid TEST document number');
  const money = (cents: number) => (cents / 100).toFixed(2);
  const net = Math.round(amountCents * 100 / (100 + vatPercent));
  const vat = { type: 'VAT_RATE', code: 'STANDARD', percentage: vatPercent.toFixed(2),
    exclusive: money(net), inclusive: money(amountCents), amount: money(amountCents - net) };
  return { type: 'RECEIPT', document: { number }, breakdown: [vat],
    totals: { vat: { amount: vat.amount, exclusive: vat.exclusive, inclusive: vat.inclusive } },
    entries: [{ type: 'SALE', details: { concept: 'SERVICE' }, data: {
      type: 'ITEM', text: name, unit: { quantity: '1.00', price: { inclusive: vat.inclusive, exclusive: vat.exclusive } },
      value: { base: vat.exclusive, discount: '0.00' }, vat,
    } }],
    payments: [{ type: 'CARD', kind: 'CREDIT', number: '****', details: { amount: vat.inclusive } }],
  };
}
