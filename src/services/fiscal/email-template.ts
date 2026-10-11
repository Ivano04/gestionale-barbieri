export interface FiscalEmailPayload { from: string; to: string; subject: string; html: string; text: string }
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}
export function fiscalTestEmailPayload(args: { from: string; to: string; salonName: string; number: string; amountCents: number; operation?: string }): FiscalEmailPayload {
  if (!Number.isSafeInteger(args.amountCents) || args.amountCents <= 0) throw new Error('Invalid receipt email amount');
  const amount = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(args.amountCents / 100);
  const label = args.operation === 'cancellation' ? 'Annullo ricevuta TEST' : 'Ricevuta TEST';
  const text = `${label} - ${args.salonName}\nDocumento: ${args.number}\nPagamento online: ${amount}\n\nIl PDF della ricevuta di prova e allegato. Questo documento TEST non ha valore fiscale. Il PDF sandbox e dimostrativo e potrebbe mostrare importi diversi.\n\nEmail inviata al destinatario autorizzato per il test.`;
  return { from: args.from, to: args.to, subject: `${label} ${args.number}`,
    text, html: `<h1>${label}</h1><p>${escapeHtml(args.salonName)}</p><p>Documento: ${escapeHtml(args.number)}<br>Pagamento online: ${escapeHtml(amount)}</p><p>Il PDF della ricevuta di prova e allegato.</p><p><strong>Questo documento TEST non ha valore fiscale.</strong> Il PDF sandbox e dimostrativo e potrebbe mostrare importi diversi.</p><p>Email inviata al destinatario autorizzato per il test.</p>` };
}
