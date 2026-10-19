import type { CalendarFinance } from '@/lib/calendar-finance';
import { unknownFinance } from '@/lib/calendar-finance';
export type PaymentRow = { status: string; amount_cents: number };
export type SaleRow = { kind: string; state: string; amount_cents: number; credit_cents: number; tender_cents: number; payment_method: string; reversals: { sale_id: string }[] };
export type DocumentRow = { operation: string; status: string; processing_status: string };
export function financialSummary(source: string, payments: PaymentRow[] | null, sales: SaleRow[] | null, documents: DocumentRow[] | null, refunds: { state: string }[] | null): CalendarFinance {
  const result = { ...unknownFinance };
  if (payments && sales) {
    const baseSales = sales.filter(s => s.kind === 'appointment');
    const succeeded = payments.filter(p => p.status === 'succeeded');
    const returned = payments.filter(p => p.status === 'refunded');
    const activeSales = baseSales.filter(s => !s.reversals.length);
    const reversedSales = baseSales.filter(s => s.reversals.length);
    const partial = payments.some(p => p.status === 'partially_refunded');
    if (partial || ((returned.length || reversedSales.length) && (succeeded.length || activeSales.length))) {
      result.payment = 'partial_refund'; result.paymentDetail = 'Rimborso parziale registrato; consulta la cassa per i dettagli';
    } else if (returned.length || reversedSales.length) {
      result.payment = 'refunded'; result.paymentDetail = reversedSales.some(s => s.credit_cents > 0) ? 'Rimborso registrato e credito utilizzato ripristinato' : 'Rimborso registrato';
    } else if (succeeded.length) {
      result.payment = 'online'; result.paymentDetail = 'Incasso online confermato';
    } else if (activeSales.length) {
      const sale = activeSales[0];
      const method = sale.payment_method === 'cash' ? 'Contanti' : 'POS';
      result.payment = 'salon';
      result.paymentDetail = sale.credit_cents > 0 ? (sale.tender_cents > 0 ? `Credito cliente + ${method}` : 'Credito cliente') : method;
    } else if (payments.some(p => ['pending', 'authorized'].includes(p.status))) {
      result.payment = 'pending'; result.paymentDetail = 'Pagamento non ancora confermato';
    } else if (documents?.some(d => d.operation === 'receipt')) {
      result.paymentDetail = 'Documento presente senza un incasso verificabile';
    } else if (['widget', 'treatwell', 'google'].includes(source)) {
      result.paymentDetail = 'Prenotazione esterna senza un incasso verificabile';
    } else {
      result.payment = 'unpaid'; result.paymentDetail = 'Nessun incasso registrato';
    }
    if (succeeded.length + activeSales.length > 1) result.notice = 'Più incassi associati: verificare in cassa';
    if (sales.some(s => s.state === 'review_required')) result.notice = 'Incasso da verificare in cassa';
    if (sales.some(s => s.kind === 'extra' && s.reversals.length)) result.notice = 'Rimborso di una vendita extra registrato';
  }
  // Fiscal status never changes a confirmed payment. PDFs and emails are independent of issuance.
  if (documents) {
    const receipts = documents.filter(d => d.operation === 'receipt');
    const cancellations = documents.filter(d => d.operation === 'cancellation');
    if (documents.some(d => ['failed', 'uncertain'].includes(d.processing_status) || d.status === 'failed')) {
      result.receipt = 'issue'; result.receiptDetail = 'Documento da verificare in cassa';
    } else if (documents.some(d => ['pending', 'processing', 'retry'].includes(d.processing_status))) {
      result.receipt = 'pending';
      result.receiptDetail = cancellations.some(d => d.processing_status !== 'completed') ? 'Annullo in elaborazione' : 'Ricevuta in elaborazione';
    } else if (receipts.length && receipts.every(d => d.status === 'canceled')) {
      result.receipt = 'canceled'; result.receiptDetail = 'Ricevuta annullata';
    } else if (receipts.some(d => d.processing_status === 'completed' && d.status !== 'canceled')) {
      const count = receipts.filter(d => d.processing_status === 'completed' && d.status !== 'canceled').length;
      result.receipt = 'issued'; result.receiptDetail = count > 1 ? `${count} ricevute emesse` : 'Ricevuta emessa';
    } else if (!documents.length) {
      result.receipt = 'none'; result.receiptDetail = 'Nessun documento fiscale presente';
    }
  }
  if (refunds === null) result.notice = 'Stato dei rimborsi non disponibile';
  else if (refunds.some(r => ['failed', 'uncertain'].includes(r.state))) result.notice = 'Rimborso da verificare in cassa';
  else if (refunds.some(r => ['pending', 'running'].includes(r.state))) result.notice = 'Rimborso in elaborazione';
  return result;
}
