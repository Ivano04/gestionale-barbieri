import type { RenderedEmail } from '@/services/notifications/templates';
export interface NoShowEmailPayload { clientName: string; salonName: string; salonPhone: string | null; visitDate: string }
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function noShowEmail(d:NoShowEmailPayload):RenderedEmail {
  const day=new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',day:'numeric',month:'long',year:'numeric'}).format(new Date(d.visitDate+'T12:00:00Z'));
  const contact=d.salonPhone ? ` Puoi chiamarci al ${d.salonPhone}.` : '';
  const text=`Ciao ${d.clientName}, il ${day} non siamo riusciti a incontrarti per la tua visita da ${d.salonName}. Se desideri fissare un nuovo appuntamento, contatta il salone.${contact} Se ci siamo sbagliati, faccelo sapere: correggeremo la segnalazione. A presto!`;
  return {subject:`La tua visita del ${day} - ${d.salonName}`,text,html:`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;line-height:1.6;color:#172033"><h2>${escape(d.salonName)}</h2><p>Ciao ${escape(d.clientName)},</p><p>Il ${escape(day)} non siamo riusciti a incontrarti per la tua visita.</p><p>Se desideri fissare un nuovo appuntamento, contatta il salone.${escape(contact)}</p><p>Se ci siamo sbagliati, faccelo sapere: correggeremo la segnalazione.</p><p>A presto!</p></div>`};
}
