export type CalendarPayment = 'unpaid' | 'online' | 'salon' | 'refunded' | 'partial_refund' | 'pending' | 'unknown';
export type CalendarReceipt = 'none' | 'pending' | 'issued' | 'issue' | 'canceled' | 'unknown';
export interface CalendarFinance {
  payment: CalendarPayment;
  paymentDetail: string;
  receipt: CalendarReceipt;
  receiptDetail: string;
  notice: string | null;
}
export const paymentAppearance: Record<CalendarPayment, { label: string; bg: string; border: string; text: string }> = {
  unpaid: { label: 'Da incassare', bg: '#fffbeb', border: '#d97706', text: '#92400e' },
  online: { label: 'Pagato online', bg: '#eff6ff', border: '#2563eb', text: '#1e40af' },
  salon: { label: 'Pagato in salone', bg: '#ecfdf5', border: '#059669', text: '#065f46' },
  refunded: { label: 'Rimborsato', bg: '#f5f3ff', border: '#7c3aed', text: '#5b21b6' },
  partial_refund: { label: 'Rimborso parziale', bg: '#f5f3ff', border: '#7c3aed', text: '#5b21b6' },
  pending: { label: 'Pagamento in verifica', bg: '#f3f4f6', border: '#6b7280', text: '#374151' },
  unknown: { label: 'Pagamento da verificare', bg: '#f3f4f6', border: '#6b7280', text: '#374151' },
};
export const unknownFinance: CalendarFinance = { payment: 'unknown', paymentDetail: 'Stato del pagamento non disponibile', receipt: 'unknown', receiptDetail: 'Stato del documento non disponibile', notice: null };
export type FinanceFilter = 'all' | 'unpaid' | 'online' | 'salon' | 'refunds' | 'verify' | 'documents' | 'issuing';
export const financeFilters: { value: FinanceFilter; label: string }[] = [
  { value: 'all', label: 'Tutti gli appuntamenti' }, { value: 'unpaid', label: 'Da incassare' },
  { value: 'online', label: 'Pagati online' }, { value: 'salon', label: 'Pagati in salone' },
  { value: 'refunds', label: 'Rimborsi' }, { value: 'verify', label: 'Pagamenti da verificare' },
  { value: 'documents', label: 'Documenti da verificare' }, { value: 'issuing', label: 'Documenti in elaborazione' },
];
export function matchesFinanceFilter(value: CalendarFinance | undefined, filter: FinanceFilter) {
  const f = value ?? unknownFinance;
  switch (filter) {
    case 'all': return true;
    case 'refunds': return ['refunded', 'partial_refund'].includes(f.payment) || !!f.notice?.includes('Rimborso');
    case 'verify': return ['unknown', 'pending'].includes(f.payment) || !!f.notice;
    case 'documents': return ['issue', 'unknown'].includes(f.receipt) || (f.receipt === 'none' && ['online', 'salon'].includes(f.payment));
    case 'issuing': return f.receipt === 'pending';
    default: return f.payment === filter;
  }
}
export const bookingSources: Record<string, string> = { widget: 'Sito / widget', phone: 'Telefono', walk_in: 'Ingresso in salone', whatsapp: 'WhatsApp', treatwell: 'Treatwell', google: 'Google', manual: 'Inserimento manuale' };
export function financeDescription(value?: CalendarFinance) {
  const f = value ?? unknownFinance;
  return [paymentAppearance[f.payment].label, f.paymentDetail, f.receiptDetail, f.notice].filter(Boolean).join(' · ');
}
