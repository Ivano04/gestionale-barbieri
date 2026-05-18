'use client';
import { format, addDays, subDays, addWeeks, subWeeks } from 'date-fns';
import { it } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

interface Props {
  date: Date;
  view: 'day' | 'week' | 'month';
  onDateChange: (d: Date) => void;
  onViewChange: (v: 'day' | 'week' | 'month') => void;
  onNewAppointment: () => void;
}

export function CalendarHeader({ date, view, onDateChange, onViewChange, onNewAppointment }: Props) {
  const prev = () => onDateChange(view === 'day' ? subDays(date, 1) : subWeeks(date, 1));
  const next = () => onDateChange(view === 'day' ? addDays(date, 1) : addWeeks(date, 1));

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-white border-b">
      <div className="flex items-center gap-3">
        <button onClick={prev} className="p-1 hover:bg-gray-100 rounded"><ChevronLeft size={20} /></button>
        <h2 className="text-lg font-semibold min-w-[200px] text-center">
          {view === 'day' && format(date, 'EEEE d MMMM yyyy', { locale: it })}
          {view === 'week' && `${format(date, 'd MMM', { locale: it })} - ${format(addDays(date, 6), 'd MMM yyyy', { locale: it })}`}
          {view === 'month' && format(date, 'MMMM yyyy', { locale: it })}
        </h2>
        <button onClick={next} className="p-1 hover:bg-gray-100 rounded"><ChevronRight size={20} /></button>
        <button onClick={() => onDateChange(new Date())} className="text-sm text-blue-600 hover:underline ml-2">Oggi</button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex bg-gray-100 rounded-lg p-1">
          {(['day', 'week', 'month'] as const).map(v => (
            <button key={v} onClick={() => onViewChange(v)}
              className={`px-3 py-1 rounded-md text-sm capitalize ${view === v ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}>
              {v === 'day' ? 'Giorno' : v === 'week' ? 'Settimana' : 'Mese'}
            </button>
          ))}
        </div>
        <button onClick={onNewAppointment}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus size={16} /> Nuovo
        </button>
      </div>
    </div>
  );
}
