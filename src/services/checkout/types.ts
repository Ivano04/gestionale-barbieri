import type { BasketLine } from './basket';
export interface QuoteSnapshot { clientId?: string | null; lines: BasketLine[]; clientName: string; salonName: string; salonAddress: string; salonPhone: string; appointmentStart: string }
export interface AppointmentQuote { id: string; number: number; version: number; status: 'draft' | 'converted'; snapshot: QuoteSnapshot; amount_cents: number; valid_until: string; created_at: string; updated_at: string }
export interface CheckoutData {
 appointment: { id: string; status: string; updatedAt: string; startTime: string; clientName: string; serviceName: string };
 lines: BasketLine[]; catalog: { id: string; name: string; price_cents: number }[];
 payments: { id: string; status: string; amount_cents: number; provider: string }[];
 sale: { id: string; payment_method: 'cash' | 'card'; amount_cents: number; state: string; quote_id: string | null; snapshot: QuoteSnapshot } | null;
 documents: { id: string; status: string; processing_status: string; operation: string; amount_cents: number; pdf_available: boolean }[];
 quote: AppointmentQuote | null; canCollect: boolean; canQuote: boolean;
}
