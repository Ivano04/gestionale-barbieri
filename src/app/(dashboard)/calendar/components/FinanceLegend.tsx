import { FileCheck2, FileClock, FileWarning } from 'lucide-react';
import { financeFilters, paymentAppearance, type FinanceFilter } from '@/lib/calendar-finance';
export function FinanceLegend({ filter, onChange, visible, total }: { filter: FinanceFilter; onChange: (value: FinanceFilter) => void; visible: number; total: number }) {
  return <div className="mx-2 md:mx-4 my-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Legenda pagamenti">
        {(['online', 'salon', 'unpaid', 'refunded', 'unknown'] as const).map(state => <span key={state} className="inline-flex items-center gap-1.5 text-slate-700"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: paymentAppearance[state].border }} />{state === 'unknown' ? 'Da verificare' : paymentAppearance[state].label}</span>)}
      </div>
      <label className="flex items-center gap-2 text-slate-700">Mostra
        <select aria-label="Filtra appuntamenti per pagamento o documento" value={filter} onChange={e => onChange(e.target.value as FinanceFilter)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs">
          {financeFilters.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
    </div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
      <span className="inline-flex items-center gap-1"><FileCheck2 size={13} className="text-emerald-800" />Ricevuta emessa</span>
      <span className="inline-flex items-center gap-1"><FileClock size={13} className="text-amber-800" />Documento in elaborazione</span>
      <span className="inline-flex items-center gap-1"><FileWarning size={13} className="text-red-700" />Documento da verificare</span>
      {filter !== 'all' && <span role="status" className="ml-auto font-medium">{visible} di {total} appuntamenti · Gli altri appuntamenti continuano a occupare i propri orari.</span>}
    </div>
  </div>;
}
