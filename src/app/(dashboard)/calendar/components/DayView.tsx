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

const COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#fb923c'];

export function DayView({ date, stylists, appointments, onSlotClick, onAppointmentClick }: Props) {
  const hours = Array.from({ length: 13 }, (_, i) => i + 8);
  if (stylists.length === 0) {
    return <div className="p-8 text-center text-gray-400">Nessun operatore configurato</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] overflow-auto bg-white rounded-lg border">
      <div className="flex border-b sticky top-0 bg-white z-10">
        <div className="w-16 flex-shrink-0 p-2 text-xs text-gray-400 text-right font-medium">Ora</div>
        {stylists.map((s, i) => (
          <div key={s.id} className="flex-1 p-3 text-center font-medium text-sm border-l flex items-center justify-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            {s.full_name}
          </div>
        ))}
      </div>
      <div className="flex flex-1 overflow-auto">
        <div className="w-16 flex-shrink-0">
          {hours.map(h => (
            <div key={h} className="h-20 border-b border-gray-50 text-xs text-gray-400 text-right pr-2 pt-0.5">
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {stylists.map(stylist => (
          <div key={stylist.id} className="flex-1 border-l">
            {hours.map(h => {
              const slotStart = setMinutes(setHours(date, h), 0);
              const slotEnd = setMinutes(setHours(date, h + 1), 0);
              const slotApps = appointments.filter(a => {
                const start = parseISO(a.start_time);
                return a.stylist_id === stylist.id && start >= slotStart && start < slotEnd;
              });
              return (
                <div key={h} className="h-20 border-b border-gray-50 p-0.5 hover:bg-blue-50/40 transition-colors cursor-pointer"
                  onClick={() => onSlotClick(stylist.id, format(slotStart, "yyyy-MM-dd'T'HH:mm:ssXXX"))}>
                  {slotApps.map(app => (
                    <AppointmentCard key={app.id} appointment={app} onClick={(e) => { e?.stopPropagation?.(); onAppointmentClick(app); }} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
