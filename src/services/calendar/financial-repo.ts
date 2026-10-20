import type { SupabaseClient } from '@supabase/supabase-js';
import { financialSummary, type PaymentRow, type SaleRow, type DocumentRow } from './financial-summary';
import { unknownFinance, type CalendarFinance } from '@/lib/calendar-finance';
type Linked<T> = T & { appointment_id: string };
// Uses the caller's authenticated client and RLS, never service-role access.
export async function attachCalendarFinance<T extends { id: string; source: string }>(db: SupabaseClient, salonId: string, appointments: T[]): Promise<(T & { finance: CalendarFinance })[]> {
  const summaries = new Map<string, CalendarFinance>();
  for (let offset = 0; offset < appointments.length; offset += 50) {
    const batch = appointments.slice(offset, offset + 50);
    const ids = batch.map(a => a.id);
    const read = async <R>(table: string, select: string): Promise<Linked<R>[] | null> => {
      try {
        const { data, error } = await db.from(table).select(select).eq('salon_id', salonId).in('appointment_id', ids).range(0, 999);
        // A truncated result must not be interpreted as an unpaid appointment.
        return error || !data || data.length >= 1000 ? null : data as unknown as Linked<R>[];
      } catch { return null; }
    };
    const [payments, sales, documents, refunds, links] = await Promise.all([
      read<PaymentRow>('payments', 'appointment_id,status,amount_cents'),
      read<SaleRow>('salon_sales', 'appointment_id,kind,state,amount_cents,credit_cents,tender_cents,payment_method,reversals:sale_reversals(sale_id)'),
      read<DocumentRow>('fiscal_documents', 'appointment_id,operation,status,processing_status'),
      read<{ state: string }>('refund_jobs', 'appointment_id,state'),
      read<{ sale: (SaleRow & { appointment_id: string; documents: DocumentRow[] }) | (SaleRow & { appointment_id: string; documents: DocumentRow[] })[] | null }>('salon_sale_appointments', 'appointment_id,sale:salon_sales(appointment_id,kind,state,amount_cents,credit_cents,tender_cents,payment_method,reversals:sale_reversals(sale_id),documents:fiscal_documents(operation,status,processing_status))'),
    ]);
    for (const a of batch) {
      const shared = links?.filter(l => l.appointment_id === a.id).flatMap(l => Array.isArray(l.sale) ? l.sale : l.sale ? [l.sale] : []).filter(s => s.appointment_id !== a.id) ?? [];
      summaries.set(a.id, financialSummary(a.source,
        payments?.filter(p => p.appointment_id === a.id) ?? null,
        sales && links ? [...sales.filter(s => s.appointment_id === a.id), ...shared] : null,
        documents && links ? [...documents.filter(d => d.appointment_id === a.id), ...shared.flatMap(s => s.documents)] : null,
        refunds?.filter(r => r.appointment_id === a.id) ?? null));
    }
  }
  return appointments.map(a => ({ ...a, finance: summaries.get(a.id) ?? { ...unknownFinance } }));
}
