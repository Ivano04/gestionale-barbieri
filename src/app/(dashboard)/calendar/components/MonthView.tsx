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
      {/* Day names header */}
      <div className="grid grid-cols-7 border-b bg-gray-50/50">
        {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
          <div key={d} className="p-2 text-center text-xs font-medium text-gray-400">{d}</div>
        ))}
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b last:border-b-0">
          {week.map((d, di) => {
            const dayApps = appointments.filter(a => isSameDay(parseISO(a.start_time), d));
            const isCurrentMonth = isSameMonth(d, monthStart);
            const isTodayDate = isSameDay(d, today);

            return (
              <div key={di}
                onClick={() => onDayClick(d)}
                className={`min-h-[80px] p-1.5 border-r last:border-r-0 cursor-pointer hover:bg-blue-50/20 transition-colors ${
                  !isCurrentMonth ? 'bg-gray-50/50 text-gray-300' : ''
                } ${isTodayDate ? 'bg-blue-50/30' : ''}`}>
                <div className={`text-xs mb-1 font-medium ${
                  isTodayDate ? 'bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center' : 'text-gray-500'
                }`}>
                  {format(d, 'd')}
                </div>
                <div className="space-y-0.5">
                  {dayApps.slice(0, 4).map(app => {
                    const src = app.source || 'manual';
                    const colors: Record<string, string> = {
                      walk_in: 'bg-green-400', phone: 'bg-blue-400', whatsapp: 'bg-teal-400',
                      widget: 'bg-purple-400', treatwell: 'bg-orange-400', google: 'bg-red-400', manual: 'bg-gray-300',
                    };
                    return (
                      <div key={app.id} className="flex items-center gap-1 text-[10px]">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors[src] || 'bg-gray-300'}`} />
                        <span className="truncate text-gray-600">
                          {app.client?.first_name?.[0]}{app.client?.last_name?.[0] || '?'} {app.service?.name?.substring(0, 8)}
                        </span>
                      </div>
                    );
                  })}
                  {dayApps.length > 4 && (
                    <div className="text-[10px] text-blue-500 font-medium">+{dayApps.length - 4} altri</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
