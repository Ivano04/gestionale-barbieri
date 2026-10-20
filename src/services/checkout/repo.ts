import { createAdminClient } from '@/lib/supabase/admin';
import { parseBasket, type BasketLine } from './basket';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export function databaseError(message?: string) {
  const errors: Record<string, string> = { ALREADY_PAID: 'Questo appuntamento ha gia un pagamento o un documento. Aggiorna la schermata.', STALE_APPOINTMENT: 'Appuntamento modificato. Aggiorna prima di proseguire.', STALE_QUOTE: 'Preventivo modificato, scaduto o gia utilizzato. Ricarica i dati.', CONFLICTING_REQUEST: 'Richiesta gia utilizzata con dati diversi.', APPOINTMENT_CLOSED: 'Appuntamento annullato o non incassabile.', TEST_CONFIG_REQUIRED: 'Configurazione fiscale TEST non disponibile.', INVALID_EXPIRY: 'La scadenza del preventivo non e valida.' };
  return json({ error: message && errors[message] || 'Operazione non completata. Ricarica i dati prima di riprovare.' }, 409);
}
export async function checkoutContext(id: string, salonId: string) {
  const db = createAdminClient();
  const { data: a, error } = await db.from('appointments').select('id,salon_id,client_id,updated_at,start_time,status,added_services,service:services(id,name,price_cents),client:clients(first_name,last_name,email),salon:salons(name,address,phone)').eq('id', id).eq('salon_id', salonId).maybeSingle();
  if (error) throw new Error('Dati non disponibili');
  if (!a) return null;
  const { data: link, error: linkError } = await db.from('salon_sale_appointments').select('sale_id').eq('salon_id', salonId).eq('appointment_id', id).maybeSingle();
  if (linkError) throw new Error('Dati non disponibili');
  const salesQuery = db.from('salon_sales').select('id,payment_method,amount_cents,state,quote_id,snapshot,kind').eq('salon_id', salonId);
  const documentsQuery = db.from('fiscal_documents').select('id,processing_status,status,pdf_storage_path,operation,amount_cents,sale_id').eq('salon_id', salonId);
  const one = <T>(value: T | T[] | null) => Array.isArray(value) ? value[0] : value ?? undefined;
  const [catalog, payments, sales, documents, quotes] = await Promise.all([
    db.from('services').select('id,name,price_cents').eq('salon_id', salonId).eq('is_active', true).order('name'),
    db.from('payments').select('id,status,amount_cents,created_at,provider').eq('salon_id', salonId).eq('appointment_id', id),
    link ? salesQuery.or(`appointment_id.eq.${id},id.eq.${link.sale_id}`) : salesQuery.eq('appointment_id', id),
    (link ? documentsQuery.or(`appointment_id.eq.${id},sale_id.eq.${link.sale_id}`) : documentsQuery.eq('appointment_id', id)).order('created_at'),
    db.from('appointment_quotes').select('*').eq('salon_id', salonId).eq('appointment_id', id).maybeSingle(),
  ]);
  if ([catalog, payments, sales, documents, quotes].some(r => r.error)) throw new Error('Dati non disponibili');
  const service = one(a.service), client = one(a.client), salon = one(a.salon);
  const lineIds: string[] = service ? [service.id] : [];
  const lines: BasketLine[] = service ? [{ description: service.name, quantity: 1, unitPriceCents: service.price_cents ?? 0, discountCents: 0 }] : [];
  if (Array.isArray(a.added_services)) for (const extra of a.added_services) {
    const found = catalog.data?.find(s => s.id === extra.service_id);
    if (found) { lineIds.push(found.id); lines.push({ description: found.name, quantity: 1, unitPriceCents: found.price_cents ?? 0, discountCents: 0 }); }
  }
  let groupedSale: { id: string; amountCents: number; appointmentIds: string[] } | null = null;
  if (link) {
    const { data: members, error: membersError } = await db.from('salon_sale_appointments').select('appointment_id').eq('salon_id', salonId).eq('sale_id', link.sale_id);
    if (membersError) throw new Error('Dati non disponibili');
    if (members && members.length > 1) groupedSale = { id: link.sale_id, amountCents: sales.data?.find(s => s.id === link.sale_id)?.amount_cents ?? 0, appointmentIds: members.map(m => m.appointment_id) };
  }
  const blockingPayment = payments.data?.some(p => ['pending','authorized','succeeded','refunded','partially_refunded'].includes(p.status));
  return { appointment: { id: a.id, updatedAt: a.updated_at, status: a.status, startTime: a.start_time, clientName: client ? `${client.first_name} ${client.last_name}`.trim() : 'Cliente occasionale', serviceName: service?.name ?? 'Servizio' },
    snapshotBase: { clientId: a.client_id, clientName: client ? `${client.first_name} ${client.last_name}`.trim() : 'Cliente occasionale', salonName: salon?.name ?? 'Salone', salonAddress: salon?.address ?? '', salonPhone: salon?.phone ?? '', appointmentStart: a.start_time },
    groupedSale, lines, lineIds, catalog: catalog.data ?? [], payments: payments.data ?? [], sale: sales.data?.find(s => s.kind === 'appointment') ?? null,
    documents: (documents.data ?? []).map(({ pdf_storage_path, ...doc }) => ({ ...doc, pdf_available: !!pdf_storage_path })), quote: quotes.data,
    canCollect: ['confirmed','completed'].includes(a.status) && !blockingPayment && !sales.data?.some(s => s.kind === 'appointment') && !documents.data?.some(d => d.operation === 'receipt' && !d.sale_id),
    canQuote: ['confirmed','completed'].includes(a.status) };
}
export function snapshot(context: NonNullable<Awaited<ReturnType<typeof checkoutContext>>>, lines: unknown) {
  const basket = parseBasket(lines);
  return { ...context.snapshotBase, lines: basket.lines };
}
