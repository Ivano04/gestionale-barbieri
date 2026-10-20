import { createAdminClient } from '@/lib/supabase/admin';
import { calendarRange } from '@/lib/calendar-range';
import type { CheckoutAppointment, CommerceLine } from '@/services/commerce/types';
import type { checkoutContext } from './repo';
const one = <T>(value: T | T[] | null) => Array.isArray(value) ? value[0] : value ?? undefined;
export async function checkoutDay(salonId: string, context: NonNullable<Awaited<ReturnType<typeof checkoutContext>>>): Promise<CheckoutAppointment[]> {
  const cid = context.snapshotBase.clientId;
  if (!cid) return [];
  const db = createAdminClient();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(context.appointment.startTime));
  const range = calendarRange(date);
  const { data: appointments, error } = await db.from('appointments')
    .select('id,updated_at,start_time,status,added_services,service:services(id,name,price_cents),stylist:users(full_name)')
    .eq('salon_id', salonId).eq('client_id', cid).gte('start_time', range.start).lt('start_time', range.end).order('start_time').limit(51);
  if (error || !appointments || appointments.length >= 51) throw new Error('Appuntamenti non disponibili');
  if (!appointments.length) return [];
  const ids = appointments.map(a => a.id);
  const [payments, links, documents, quotes, services] = await Promise.all([
    db.from('payments').select('appointment_id,status').eq('salon_id', salonId).in('appointment_id', ids).limit(1000),
    db.from('salon_sale_appointments').select('appointment_id').eq('salon_id', salonId).in('appointment_id', ids),
    db.from('fiscal_documents').select('appointment_id').eq('salon_id', salonId).in('appointment_id', ids).is('sale_id', null).eq('operation', 'receipt').limit(1000),
    db.from('appointment_quotes').select('appointment_id').eq('salon_id', salonId).in('appointment_id', ids).eq('status', 'draft'),
    db.from('services').select('id,name,price_cents').eq('salon_id', salonId).limit(1000),
  ]);
  if ([payments, links, documents, quotes, services].some(r => r.error || !r.data || r.data.length >= 1000)) throw new Error('Dati non disponibili');
  return appointments.map(a => {
    const service = one(a.service);
    const apPayments = payments.data!.filter(p => p.appointment_id === a.id);
    let reason: string | null = null;
    if (!['confirmed', 'completed'].includes(a.status)) reason = 'Appuntamento annullato o non incassabile';
    else if (apPayments.some(p => ['pending', 'authorized'].includes(p.status))) reason = 'Pagamento da verificare';
    else if (apPayments.some(p => ['succeeded', 'refunded', 'partially_refunded'].includes(p.status))) reason = 'Pagamento online già registrato';
    else if (links.data!.some(l => l.appointment_id === a.id)) reason = 'Incasso già registrato';
    else if (documents.data!.some(d => d.appointment_id === a.id)) reason = 'Documento già presente';
    const selectedServices = service ? [service] : [];
    if (Array.isArray(a.added_services)) for (const extra of a.added_services) {
      const found = services.data!.find(s => s.id === extra.service_id);
      if (found) selectedServices.push(found);
      else reason ??= 'Servizio non più disponibile: verifica l’appuntamento';
    }
    const lines: CommerceLine[] = selectedServices.map(s => ({ kind: 'service', id: s.id, appointmentId: a.id, description: s.name, quantity: 1, unitPriceCents: s.price_cents ?? 0, discountCents: 0 }));
    if (!lines.length) reason ??= 'Servizio da verificare';
    return { id: a.id, updatedAt: a.updated_at, startTime: a.start_time, serviceName: service?.name ?? 'Servizio', stylistName: one(a.stylist)?.full_name ?? '', canCollect: !reason, reason, hasQuote: quotes.data!.some(q => q.appointment_id === a.id), lines };
  });
}
