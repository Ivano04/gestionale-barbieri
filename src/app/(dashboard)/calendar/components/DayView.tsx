'use client';
import { format, setHours, setMinutes, parseISO } from 'date-fns';
import { AppointmentCard } from './AppointmentCard';
import type { Appointment, User } from '@/lib/types';

interface Props {
  date: Date;
  stylists: Pick<User, 'id' | 'full_name'>[];
  appointments: Appointment[];
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
}

const STYLIST_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#fb923c'];

function isToday(d: Date): boolean {
  const now = new Date();
  return format(d, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd');
}

export function DayView({ date, stylists, appointments, onSlotClick, onAppointmentClick }: Props) {
  const hours = Array.from({ length: 13 }, (_, i) => i + 8);
  const today = isToday(date);

  if (stylists.length === 0) {
    return (
      <div className="p-12 text-center bg-white rounded-xl border">
        <p className="text-gray-400 text-lg mb-2">Nessun operatore configurato</p>
        <p className="text-gray-300 text-sm">Aggiungi operatori dalle impostazioni per visualizzare il calendario</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] overflow-hidden bg-white rounded-xl border shadow-sm">
      {/* Header row */}
      <div className="flex border-b bg-gray-50/50 sticky top-0 z-10 rounded-t-xl">
        <div className="w-14 flex-shrink-0 p-2" />
        {stylists.map((s, i) => (
          <div key={s.id}
            className="flex-1 p-3 text-center font-semibold text-sm border-l border-gray-100 flex items-center justify-center gap-2 bg-white/60">
            <div className="w-3 h-3 rounded-full ring-2 ring-offset-1 ring-gray-200"
              style={{ backgroundColor: STYLIST_COLORS[i % STYLIST_COLORS.length] }} />
            {s.full_name}
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="flex flex-1 overflow-auto">
        {/* Time labels */}
        <div className="w-14 flex-shrink-0 bg-gray-50/30">
          {hours.map(h => (
            <div key={h} className={`h-20 border-b border-gray-100 text-[11px] text-gray-400 text-right pr-2 pt-0.5 font-medium ${
              today && new Date().getHours() === h ? 'bg-blue-50/50 text-blue-500' : ''
            }`}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Stylist columns */}
        {stylists.map(stylist => (
          <div key={stylist.id} className="flex-1 border-l border-gray-100">
            {hours.map(h => {
              const slotStart = setMinutes(setHours(date, h), 0);
              const slotEnd = setMinutes(setHours(date, h + 1), 0);
              const slotApps = appointments.filter(a => {
                if (a.status === 'cancelled') return false;
                const start = parseISO(a.start_time);
                return a.stylist_id === stylist.id && start >= slotStart && start < slotEnd;
              });
              const isCurrentHour = today && new Date().getHours() === h;

              return (
                <div key={h}
                  className={`h-20 border-b border-gray-50 p-1 transition-colors cursor-pointer group ${
                    isCurrentHour ? 'bg-blue-50/30' : 'hover:bg-gray-50/50'
                  }`}
                  onClick={() => onSlotClick(stylist.id, format(slotStart, "yyyy-MM-dd'T'HH:mm:ssXXX"))}>
                  {slotApps.map(app => (
                    <AppointmentCard key={app.id} appointment={app}
                      onClick={(e) => { e?.stopPropagation?.(); onAppointmentClick(app); }} />
                  ))}
                  {/* Empty slot hint */}
                  {slotApps.length === 0 && (
                    <div className="h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] text-gray-300">+</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
