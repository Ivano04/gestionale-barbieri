import { BOOKING_UUID } from '@/lib/booking-services';
export function parseAttendanceRequest(value: unknown, appointmentId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Richiesta non valida');
  const v = value as Record<string, unknown>;
  if (typeof v.requestId !== 'string' || !BOOKING_UUID.test(v.requestId) || !BOOKING_UUID.test(appointmentId) || !['mark','restore'].includes(String(v.action))) throw new Error('Richiesta non valida');
  if (!Array.isArray(v.ids) || !v.ids.length || v.ids.length>50 || v.ids.some(id=>typeof id!=='string'||!BOOKING_UUID.test(id))) throw new Error('Seleziona gli appuntamenti');
  const ids = v.ids.map(id=>(id as string).toLowerCase()).sort();
  if (new Set(ids).size!==ids.length) throw new Error('Appuntamenti duplicati');
  if (!Array.isArray(v.expected) || !v.expected.length || v.expected.length>50) throw new Error('Ricarica gli appuntamenti');
  const expected = v.expected.map(raw=>{
    if (!raw || typeof raw!=='object') throw new Error('Appuntamento non valido');
    const e=raw as Record<string,unknown>;
    if(typeof e.id!=='string'||!BOOKING_UUID.test(e.id)||typeof e.updatedAt!=='string'||!Number.isFinite(Date.parse(e.updatedAt))) throw new Error('Ricarica gli appuntamenti');
    // Preserve PostgreSQL timestamp precision for optimistic concurrency checks.
    return {id:e.id.toLowerCase(),updatedAt:e.updatedAt};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(expected.map(e=>e.id)).size!==expected.length || ids.some(id=>!expected.some(e=>e.id===id))) throw new Error('Selezione incoerente');
  return { requestId:v.requestId.toLowerCase(),action:v.action as 'mark'|'restore',appointmentId:appointmentId.toLowerCase(),ids,expected };
}
export const attendanceErrors: Record<string,string> = {
  VISIT_NOT_FINISHED:'Puoi segnalare la mancata presenza solo dopo la fine dell’ultimo appuntamento della sequenza.',
  STALE_VISIT:'Gli appuntamenti sono cambiati. Ricarica prima di proseguire.',VISIT_MISMATCH:'La sequenza è cambiata. Ricarica gli appuntamenti.',
  APPOINTMENT_CLOSED:'Uno degli appuntamenti è stato annullato.',APPOINTMENT_NOT_FOUND:'Appuntamento non disponibile.',
  CONFLICTING_REQUEST:'Questa richiesta è già stata utilizzata con dati diversi.',VISIT_TOO_LARGE:'La sequenza contiene troppi appuntamenti.',
};
