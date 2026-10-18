import { it,expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { quotePdf } from './quote-pdf';
import type { AppointmentQuote } from './types';
const quote:AppointmentQuote={id:'id',number:1,version:2,status:'draft',amount_cents:2440,valid_until:'2026-11-18',created_at:'2026-10-18T10:00:00Z',updated_at:'2026-10-18T11:00:00Z',snapshot:{clientName:'Cliente con accento ? e simbolo ??',salonName:'Hairforce',salonAddress:'Firenze',salonPhone:'',appointmentStart:'2026-10-20T10:00:00Z',lines:[{description:'Taglio',quantity:1,unitPriceCents:2440,discountCents:0}]}};
it('creates a real downloadable PDF with Italian characters and unsupported-character fallback',async()=>{const bytes=await quotePdf(quote);expect(Buffer.from(bytes).subarray(0,5).toString()).toBe('%PDF-');const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBe(1);expect(pdf.getTitle()).toContain('PRV-1');});
it('paginates a long quote instead of clipping rows',async()=>{const bytes=await quotePdf({...quote,snapshot:{...quote.snapshot,lines:Array.from({length:30},()=>({...quote.snapshot.lines[0],description:'Servizio completo '.repeat(7)}))}});expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);});
