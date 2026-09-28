import type { NotificationType } from './types';

export interface BookingEmailData {
  clientName: string;
  serviceName: string;
  dateText: string; // gia' formattato (es. "lunedì 23 dicembre 2026")
  timeText: string; // gia' formattato (es. "10:00")
  salonName: string;
  reviewUrl?: string; // solo per l'email recensione
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
    <p style="font-size:12px;color:#888">Questa email è stata inviata automaticamente da ${salonName}.</p>
  </div>`;
}

export function confirmationEmail(d: BookingEmailData): RenderedEmail {
  const subject = `Prenotazione confermata — ${d.serviceName} ${d.dateText}`;
  const html = layout(
    d.salonName,
    `<p>Ciao ${d.clientName},</p>
     <p>la tua prenotazione è <strong>confermata</strong>. Ecco i dettagli:</p>
     <ul>
       <li><strong>Servizio:</strong> ${d.serviceName}</li>
       <li><strong>Data:</strong> ${d.dateText}</li>
       <li><strong>Ora:</strong> ${d.timeText}</li>
     </ul>
     <p>Ti aspettiamo!</p>`,
  );
  const text = `Ciao ${d.clientName}, la tua prenotazione è confermata: ${d.serviceName}, ${d.dateText} alle ${d.timeText}. — ${d.salonName}`;
  return { subject, html, text };
}

export function reminderEmail(d: BookingEmailData): RenderedEmail {
  const subject = `Promemoria — ${d.serviceName} ${d.dateText} alle ${d.timeText}`;
  const html = layout(
    d.salonName,
    `<p>Ciao ${d.clientName},</p>
     <p>ti ricordiamo il tuo appuntamento in arrivo:</p>
     <ul>
       <li><strong>Servizio:</strong> ${d.serviceName}</li>
       <li><strong>Data:</strong> ${d.dateText}</li>
       <li><strong>Ora:</strong> ${d.timeText}</li>
     </ul>
     <p>A presto!</p>`,
  );
  const text = `Ciao ${d.clientName}, promemoria appuntamento: ${d.serviceName}, ${d.dateText} alle ${d.timeText}. — ${d.salonName}`;
  return { subject, html, text };
}

export function reviewEmail(d: BookingEmailData): RenderedEmail {
  const subject = `Com'è andata da ${d.salonName}? Lasciaci una recensione`;
  const cta = d.reviewUrl
    ? `<p style="margin:24px 0"><a href="${d.reviewUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Lascia una recensione</a></p>`
    : `<p>Rispondi pure a questa email per dirci com'è andata.</p>`;
  const html = layout(
    d.salonName,
    `<p>Ciao ${d.clientName},</p>
     <p>grazie per essere passato/a da noi per <strong>${d.serviceName}</strong>! Ci farebbe piacere sapere com'è andata.</p>
     ${cta}
     <p>Grazie e a presto!</p>`,
  );
  const text = `Ciao ${d.clientName}, grazie per la tua visita (${d.serviceName})! Lasciaci una recensione${d.reviewUrl ? ': ' + d.reviewUrl : ''}. — ${d.salonName}`;
  return { subject, html, text };
}
