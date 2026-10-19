import { AlertTriangle, Banknote, CircleHelp, Clock3, CreditCard, FileCheck2, FileClock, FileWarning, FileX2, Globe, MessageCircle, PenLine, Phone, RotateCcw, Store, type LucideIcon } from 'lucide-react';
import { bookingSources, financeDescription, paymentAppearance, unknownFinance, type CalendarFinance, type CalendarPayment } from '@/lib/calendar-finance';
const paymentIcons: Record<CalendarPayment, LucideIcon> = { unpaid: Banknote, online: CreditCard, salon: Store, refunded: RotateCcw, partial_refund: RotateCcw, pending: Clock3, unknown: CircleHelp };
export function BookingSource({ source }: { source: string }) {
  const Icon = source === 'phone' ? Phone : source === 'whatsapp' ? MessageCircle : source === 'walk_in' ? Store : ['widget', 'google', 'treatwell'].includes(source) ? Globe : PenLine;
  const label = `Prenotazione: ${bookingSources[source] ?? source}`;
  return <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 text-slate-500"><Icon size={11} aria-hidden="true" /></span>;
}
export function FinancialStatus({ finance, expanded = false }: { finance?: CalendarFinance; expanded?: boolean }) {
  const f = finance ?? unknownFinance, appearance = paymentAppearance[f.payment];
  const Payment = paymentIcons[f.payment];
  const Receipt = f.receipt === 'issued' ? FileCheck2 : f.receipt === 'pending' ? FileClock : f.receipt === 'canceled' ? FileX2 : FileWarning;
  const receiptColor = f.receipt === 'issued' ? 'text-emerald-800' : f.receipt === 'issue' ? 'text-red-700' : f.receipt === 'pending' ? 'text-amber-800' : 'text-slate-600';
  return <span className={expanded ? 'flex flex-col gap-1 text-xs' : 'inline-flex shrink-0 items-center gap-1'} title={financeDescription(f)}>
    <span role="img" aria-label={`${appearance.label}: ${f.paymentDetail}`} className="inline-flex items-center gap-1" style={{ color: appearance.text }}>
      <Payment size={expanded ? 14 : 12} aria-hidden="true" />
      {expanded && <span><strong>{appearance.label}</strong> · {f.paymentDetail}</span>}
    </span>
    {(f.receipt !== 'none' || expanded) && <span role="img" aria-label={f.receiptDetail} className={`inline-flex items-center gap-1 ${receiptColor}`}>
      <Receipt size={expanded ? 14 : 12} aria-hidden="true" />{expanded && f.receiptDetail}
    </span>}
    {f.notice && <span role="img" aria-label={f.notice} className="inline-flex items-center gap-1 text-red-700"><AlertTriangle size={expanded ? 14 : 12} aria-hidden="true" />{expanded && f.notice}</span>}
  </span>;
}
