'use client';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, parseISO, isSameDay, isSameMonth } from 'date-fns';
import { it } from 'date-fns/locale';
import type { Appointment } from '@/lib/types';

interface Props {
  date: Date;
  appointments: Appointment[];
  onDayClick: (date: Date) => void;
}

export function MonthView({ date, appointments, onDayClick }: Props) {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const weeks: Date[][] = [];
  let current = calStart;
  while (current <= calEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(current);
      current = addDays(current, 1);
    }
    weeks.push(week);
  }

  const today = new Date();

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="grid grid-cols-7 border-b bg-gray-50/50">
        {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
          <div key={d} className="p-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">{d}</div>
        ))}
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b last:border-b-0">
          {week.map((d, di) => {
            const count = appointments.filter(a => isSameDay(parseISO(a.start_time), d)).length;
            const isCurrentMonth = isSameMonth(d, monthStart);
            const isTodayDate = isSameDay(d, today);

            return (
              <div key={di}
                onClick={() => onDayClick(d)}
                className={`min-h-[90px] p-2 border-r last:border-r-0 cursor-pointer hover:bg-blue-50/30 transition-colors flex flex-col items-center justify-center ${
                  !isCurrentMonth ? 'bg-gray-50/30' : ''
                } ${isTodayDate ? 'bg-blue-50/20' : ''}`}>
                <div className={`text-sm font-semibold mb-1 ${
                  isTodayDate ? 'bg-blue-600 text-white w-7 h-7 rounded-full flex items-center justify-center' :
                  !isCurrentMonth ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {format(d, 'd')}
                </div>
                {isCurrentMonth && count > 0 && (
                  <div className={`text-xs font-bold rounded-full px-2 py-0.5 ${
                    count >= 10 ? 'bg-red-100 text-red-700' :
                    count >= 5 ? 'bg-orange-100 text-orange-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {count} app
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
