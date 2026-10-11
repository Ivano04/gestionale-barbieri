
export interface BookingEmailData {
  clientName: string;
  serviceName: string;
  dateText: string; // gia' formattato (es. "lunedÃ¬ 23 dicembre 2026")
  timeText: string; // gia' formattato (es. "10:00")
  salonName: string;
  reviewUrl?: string; // solo per l'email recensione
  rescheduleUrl?: string;
  cancelUrl?: string; // link di annullo (conferma/promemoria)
  refundPending?: boolean;
  refundIssue?: boolean;
  refunded?: boolean; // solo per l'email di annullamento
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function layout(salonName: string, bodyHtml: string): string {
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
    <h2 style="color:#2563eb">${salonName}</h2>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="font-size:12px;color:#888">Questa email Ã¨ stata inviata automaticamente da ${salonName}.</p>
  </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}
function managementLinks(d: BookingEmailData): string {
  return `${d.rescheduleUrl ? `<p><a href="${escapeHtml(d.rescheduleUrl)}" style="color:#2563eb;font-weight:600">Modifica data e ora</a></p>` : ''}${d.cancelUrl ? `<p style="font-size:13px;color:#666">Vuoi disdire? <a href="${escapeHtml(d.cancelUrl)}">Annulla la prenotazione</a>.</p>` : ''}`;
}
function managementText(d: BookingEmailData): string {
  return `${d.rescheduleUrl ? '\nModifica data e ora: ' + d.rescheduleUrl : ''}${d.cancelUrl ? '\nAnnulla prenotazione: ' + d.cancelUrl : ''}`;
}
export function rescheduledEmail(d: BookingEmailData): RenderedEmail {
  const subject = `Appuntamento spostato - ${d.serviceName} ${d.dateText}`;
  const html = layout(escapeHtml(d.salonName), `<p>Ciao ${escapeHtml(d.clientName)},</p><p>Il nuovo orario e confermato:</p><ul><li>${escapeHtml(d.serviceName)}</li><li>${escapeHtml(d.dateText)} alle ${escapeHtml(d.timeText)}</li></ul><p>Il pagamento resta associato alla stessa prenotazione.</p>${managementLinks(d)}`);
  return { subject, html, text: `Ciao ${d.clientName}, appuntamento spostato: ${d.serviceName}, ${d.dateText} alle ${d.timeText}. Il pagamento resta valido.` + managementText(d) };
}

export function confirmationEmail(d: BookingEmailData): RenderedEmail {
  const subject = `Prenotazione confermata â€” ${d.serviceName} ${d.dateText}`;
  const cancelLine = managementLinks(d);
  const html = layout(
    d.salonName,
    `<p>Ciao ${d.clientName},</p>
     <p>la tua prenotazione Ã¨ <strong>confermata</strong>. Ecco i dettagli:</p>
     <ul>
       <li><strong>Servizio:</strong> ${d.serviceName}</li>
       <li><strong>Data:</strong> ${d.dateText}</li>
       <li><strong>Ora:</strong> ${d.timeText}</li>
     </ul>
     <p>Ti aspettiamo!</p>
     ${cancelLine}`,
  );
  const text = `Ciao ${d.clientName}, la tua prenotazione Ã¨ confermata: ${d.serviceName}, ${d.dateText} alle ${d.timeText}. â€” ${d.salonName}`;
  return { subject, html, text: text + managementText(d) };
}

export function reminderEmail(d: BookingEmailData): RenderedEmail {
  const subject = `Promemoria â€” ${d.serviceName} ${d.dateText} alle ${d.timeText}`;
  const html = layout(
    d.salonName,
    `<p>Ciao ${d.clientName},</p>
     <p>ti ricordiamo il tuo appuntamento in arrivo:</p>
     <ul>
       <li><strong>Servizio:</strong> ${d.serviceName}</li>
       <li><strong>Data:</strong> ${d.dateText}</li>
       <li><strong>Ora:</strong> ${d.timeText}</li>
     </ul>
     <p>A presto!</p>
     ${managementLinks(d)}`,
  );
  const text = `Ciao ${d.clientName}, promemoria appuntamento: ${d.serviceName}, ${d.dateText} alle ${d.timeText}. â€” ${d.salonName}`;
  return { subject, html, text: text + managementText(d) };
}

export function cancellationEmail(d: BookingEmailData): RenderedEmail {
  const subject = `Prenotazione annullata â€” ${d.serviceName} ${d.dateText}`;
  const refundLine = d.refunded
    ? `<p>Ti abbiamo rimborsato l'importo pagato: lo vedrai riaccreditato sul metodo di pagamento originale entro qualche giorno lavorativo.</p>`
    : d.refundPending ? `<p>La richiesta di rimborso e stata registrata ed e in elaborazione. Contattaci per aggiornamenti.</p>`
    : d.refundIssue ? `<p>Il rimborso richiede una verifica del salone. Contattaci per aggiornamenti.</p>`
    : `<p>Secondo le condizioni di cancellazione, per questo annullamento non e previsto un rimborso. Per qualsiasi necessita, contatta il salone.</p>`;
  const html = layout(
    d.salonName,
    `<p>Ciao ${d.clientName},</p>
     <p>la tua prenotazione Ã¨ stata <strong>annullata</strong>:</p>
     <ul>
       <li><strong>Servizio:</strong> ${d.serviceName}</li>
       <li><strong>Data:</strong> ${d.dateText}</li>
       <li><strong>Ora:</strong> ${d.timeText}</li>
     </ul>
     ${refundLine}`,
  );
  const text = `Ciao ${d.clientName}, la tua prenotazione (${d.serviceName}, ${d.dateText} ${d.timeText}) Ã¨ stata annullata.${d.refunded ? ' Rimborso accettato.' : d.refundPending ? ' Rimborso richiesto, in elaborazione.' : d.refundIssue ? ' Rimborso da verificare con il salone.' : ''} â€” ${d.salonName}`;
  return { subject, html, text };
}

export function reviewEmail(d: BookingEmailData): RenderedEmail {
  const subject = `Com'Ã¨ andata da ${d.salonName}? Lasciaci una recensione`;
  const cta = d.reviewUrl
    ? `<p style="margin:24px 0"><a href="${d.reviewUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Lascia una recensione</a></p>`
    : `<p>Rispondi pure a questa email per dirci com'Ã¨ andata.</p>`;
  const html = layout(
    d.salonName,
    `<p>Ciao ${d.clientName},</p>
     <p>grazie per essere passato/a da noi per <strong>${d.serviceName}</strong>! Ci farebbe piacere sapere com'Ã¨ andata.</p>
     ${cta}
     <p>Grazie e a presto!</p>`,
  );
  const text = `Ciao ${d.clientName}, grazie per la tua visita (${d.serviceName})! Lasciaci una recensione${d.reviewUrl ? ': ' + d.reviewUrl : ''}. â€” ${d.salonName}`;
  return { subject, html, text };
}
