import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { AppointmentQuote } from './types';
export async function quotePdf(quote: AppointmentQuote): Promise<Uint8Array> {
 const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
 pdf.setTitle(`Preventivo PRV-${quote.number}`); pdf.setCreationDate(new Date(quote.created_at)); pdf.setModificationDate(new Date(quote.updated_at));
 let page = pdf.addPage([595,842]), y = 792;
 const clean = (s: string) => Array.from(s.replace(/[\r\n\t]/g, ' ')).map(char => { try { font.encodeText(char); return char; } catch { return '?'; } }).join('');
 const line = (text: string, heading = false) => {
  let remaining = clean(text);
  do {
   if (y < 65) { page = pdf.addPage([595,842]); y = 792; }
   let end = remaining.length;
   while (end > 1 && font.widthOfTextAtSize(remaining.slice(0,end), heading ? 15 : 11) > 495) end--;
   page.drawText(remaining.slice(0,end), { x: 50, y, size: heading ? 15 : 11, font: heading ? bold : font, color: rgb(.1,.15,.2) });
   remaining = remaining.slice(end); y -= heading ? 24 : 18;
  } while (remaining.length);
 };
 const euro = (cents: number) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(cents/100);
 const data = quote.snapshot;
 line(data.salonName, true); if(data.salonAddress)line(data.salonAddress); if(data.salonPhone)line(data.salonPhone);
 y-=15; line(`PREVENTIVO PRV-${String(quote.number).padStart(6,'0')}`,true);
 line(`Versione ${quote.version} - ${quote.status === 'converted' ? 'Convertito in incasso' : 'Bozza'}`);
 line('Documento non fiscale. Non attesta un pagamento.');
 line(`Cliente: ${data.clientName}`);
 line(`Appuntamento: ${new Date(data.appointmentStart).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}`);
 line(`Valido fino al: ${new Date(quote.valid_until+'T12:00:00Z').toLocaleDateString('it-IT',{timeZone:'Europe/Rome'})}`); y-=15;
 for (const item of data.lines) {
  line(`${item.quantity} x ${item.description}`);
  line(`${euro(item.unitPriceCents)} cad. - Sconto ${euro(item.discountCents)} - Totale ${euro(item.quantity*item.unitPriceCents-item.discountCents)}`); y-=8;
 }
 y-=12; line(`TOTALE ${euro(quote.amount_cents)}`,true); line('Importi indicati IVA inclusa. Nessuna emissione fiscale con il preventivo.');
 for (const [index,p] of pdf.getPages().entries()) p.drawText(`PRV-${quote.number} / v${quote.version} - Pagina ${index+1}`,{x:50,y:30,size:9,font});
 return pdf.save();
}
