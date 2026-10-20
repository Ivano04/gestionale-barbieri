"use client";
import type { CheckoutAppointment } from '@/services/commerce/types';
import { money } from './shared';
export function AppointmentSelection({ appointments, selected, primaryId, locked, onToggle }: {
  appointments: CheckoutAppointment[]; selected: string[]; primaryId: string; locked: boolean;
  onToggle: (appointment: CheckoutAppointment, checked: boolean) => void;
}) {
  if (appointments.length < 2) return null;
  return <fieldset disabled={locked} className="border border-gray-200 rounded-xl p-4 space-y-3">
    <legend className="px-1 font-semibold">Appuntamenti dello stesso cliente nella giornata</legend>
    <p className="text-sm text-gray-600">Seleziona quelli da incassare insieme. Riceveranno un unico documento commerciale.</p>
    <div className="space-y-2">
      {appointments.map(a => <label key={a.id} className={`flex items-start gap-3 border rounded-lg p-3 ${!a.canCollect ? 'bg-gray-50 text-gray-500' : selected.includes(a.id) ? 'bg-blue-50 border-blue-200' : 'border-gray-200'}`}>
        <input type="checkbox" className="mt-1" aria-label={`Includi ${a.serviceName} delle ${new Date(a.startTime).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })}`}
          checked={selected.includes(a.id)} disabled={locked || a.id === primaryId || !a.canCollect || selected.length >= 20 && !selected.includes(a.id)}
          onChange={e => onToggle(a, e.target.checked)} />
        <span className="flex-1 min-w-0 text-sm">
          <span className="font-medium">{new Date(a.startTime).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })} · {a.serviceName}</span>
          {a.stylistName && <span className="block text-gray-500">{a.stylistName}</span>}
          {a.reason && <span className="block">{a.reason}</span>}
          {a.hasQuote && a.canCollect && <span className="block text-amber-800">Preventivo disponibile: verifica gli importi prima di incassare.</span>}
        </span>
        {a.canCollect && <span className="text-sm whitespace-nowrap">{money(a.lines.reduce((n, l) => n + l.quantity * l.unitPriceCents - l.discountCents, 0))}</span>}
      </label>)}
    </div>
    <p className="text-sm font-medium">{selected.length} {selected.length === 1 ? 'appuntamento selezionato' : 'appuntamenti selezionati'} · 1 documento</p>
  </fieldset>;
}
