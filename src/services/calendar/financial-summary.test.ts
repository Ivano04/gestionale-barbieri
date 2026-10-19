import { describe, it, expect } from 'vitest';
import { financialSummary, type SaleRow, type DocumentRow } from './financial-summary';
import { matchesFinanceFilter } from '@/lib/calendar-finance';
const payment = (status = 'succeeded') => ({ status, amount_cents: 2800 });
const sale = (patch: Partial<SaleRow> = {}): SaleRow => ({ kind: 'appointment', state: 'recorded', amount_cents: 2800, credit_cents: 0, tender_cents: 2800, payment_method: 'cash', reversals: [], ...patch });
const doc = (patch: Partial<DocumentRow> = {}): DocumentRow => ({ operation: 'receipt', processing_status: 'completed', status: 'confirmed', ...patch });
describe('calendar financial truth', () => {
  it('a source alone never proves an online payment', () => {
    for (const source of ['widget', 'treatwell', 'google']) expect(financialSummary(source, [], [], [], []).payment).toBe('unknown');
    expect(financialSummary('phone', [], [], [], []).payment).toBe('unpaid');
  });
  it('a failed attempt does not count as collection', () => expect(financialSummary('manual', [payment('failed')], [], [], []).payment).toBe('unpaid'));
  it.each(['pending', 'authorized'])('does not confuse %s with collected money', status => expect(financialSummary('widget', [payment(status)], [], [], []).payment).toBe('pending'));
  it('does not lose a settled payment because an older attempt failed', () => expect(financialSummary('manual', [payment('failed'), payment()], [], [], []).payment).toBe('online'));
  it('payment remains online when fiscal processing fails', () => expect(financialSummary('widget', [payment()], [], [doc({ processing_status: 'failed', status: 'failed' })], [])).toMatchObject({ payment: 'online', receipt: 'issue' }));
  it('documents do not prove collection', () => expect(financialSummary('manual', [], [], [doc()], []).payment).toBe('unknown'));
  it('a receipt is issued even when its PDF is not yet generated', () => expect(financialSummary('widget', [payment()], [], [doc()], []).receipt).toBe('issued'));
  it('uses recorded tender, including full and mixed credit', () => {
    expect(financialSummary('manual', [], [sale({ credit_cents: 2800, tender_cents: 0 })], [], [])).toMatchObject({ payment: 'salon', paymentDetail: 'Credito cliente' });
    expect(financialSummary('manual', [], [sale({ credit_cents: 1000, tender_cents: 1800, payment_method: 'card' })], [], []).paymentDetail).toBe('Credito cliente + POS');
  });
  it('an extra product sale does not settle the appointment', () => expect(financialSummary('manual', [], [sale({ kind: 'extra' })], [], []).payment).toBe('unpaid'));
  it('a refunded extra does not mark the paid service as refunded', () => expect(financialSummary('widget', [payment()], [sale({ kind: 'extra', reversals: [{ sale_id: 'extra' }] })], [], [])).toMatchObject({ payment: 'online', notice: 'Rimborso di una vendita extra registrato' }));
  it('recognizes a staff reversal while the fiscal cancellation is processing', () => expect(financialSummary('manual', [], [sale({ reversals: [{ sale_id: 's' }] })], [doc(), doc({ operation: 'cancellation', processing_status: 'processing', status: 'pending' })], [])).toMatchObject({ payment: 'refunded', receipt: 'pending', receiptDetail: 'Annullo in elaborazione' }));
  it('recognizes partial refunds without inventing the residual amount', () => expect(financialSummary('widget', [payment('partially_refunded')], [], [], []).payment).toBe('partial_refund'));
  it('refund pending keeps the original confirmed payment', () => expect(financialSummary('widget', [payment()], [], [], [{ state: 'pending' }])).toMatchObject({ payment: 'online', notice: 'Rimborso in elaborazione' }));
  it('a fiscal cancellation does not prove a money refund', () => expect(financialSummary('widget', [payment()], [], [doc({ status: 'canceled' }), doc({ operation: 'cancellation' })], [])).toMatchObject({ payment: 'online', receipt: 'canceled' }));
  it.each(['retry', 'uncertain', 'failed'])('handles fiscal %s without declaring all documents issued', processing_status => expect(financialSummary('widget', [payment()], [], [doc(), doc({ processing_status, status: 'pending' })], []).receipt).toBe(processing_status === 'retry' ? 'pending' : 'issue'));
  it('a failed fiscal read does not hide payment success', () => expect(financialSummary('widget', [payment()], [], null, [])).toMatchObject({ payment: 'online', receipt: 'unknown' }));
  it('a failed payment read never defaults to unpaid', () => expect(financialSummary('manual', null, [], [], []).payment).toBe('unknown'));
  it('filters documents independently from payment', () => {
    const f = financialSummary('widget', [payment()], [], [doc({ processing_status: 'uncertain' })], []);
    expect(matchesFinanceFilter(f, 'online')).toBe(true); expect(matchesFinanceFilter(f, 'documents')).toBe(true); expect(matchesFinanceFilter(f, 'unpaid')).toBe(false);
    expect(matchesFinanceFilter(undefined, 'verify')).toBe(true);
  });
});
