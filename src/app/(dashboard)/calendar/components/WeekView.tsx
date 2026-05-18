'use client';
import { format, startOfWeek, addDays, parseISO, isSameDay } from 'date-fns';
import { it } from 'date-fns/locale';
import type { Appointment, User } from '@/lib/types';

interface Props {
  date: Date;
  stylists: Pick<User, 'id' | 'full_name'>[];
  appointments: Appointment[];
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
}

const STYLIST_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24'];

const sourceColors: Record<string, string> = {
  walk_in: '#059669', phone: '#2563eb', whatsapp: '#0d9488', widget: '#7c3aed',
  treatwell: '#ea580c', google: '#dc2626', manual: '#6b7280',
};

export function WeekView({ date, stylists, appointments, onSlotClick, onAppointmentClick }: Props) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  if (stylists.length === 0) {
    return <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">Nessun operatore configurato</div>;
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Header row: day names */}
      <div className="grid grid-cols-8 border-b bg-gradient-to-r from-gray-50 to-white">
        <div className="p-3 flex items-end justify-center">
          <span className="text-xs font-medium text-gray-400">Operatore</span>
        </div>
        {days.map((d, i) => (
          <div key={i} className={`p-3 text-center border-l ${isSameDay(d, today) ? 'bg-blue-50/40' : ''}`}>
            <div className="text-[11px] text-gray-400 uppercase">{format(d, 'EEE', { locale: it })}</div>
            <div className={`text-lg font-bold ${isSameDay(d, today) ? 'text-blue-600' : 'text-gray-700'}`}>
              {format(d, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* Stylist rows */}
      {stylists.map((stylist, si) => (
        <div key={stylist.id} className="grid grid-cols-8 border-b last:border-b-0 hover:bg-gray-50/30 transition-colors">
          {/* Stylist name column */}
          <div className="p-3 flex items-center gap-2 border-r bg-gray-50/30">
            <div className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-offset-1 ring-gray-200"
              style={{ backgroundColor: STYLIST_COLORS[si % STYLIST_COLORS.length] }} />
            <span className="text-sm font-semibold text-gray-700 truncate">{stylist.full_name.split(' ')[0]}</span>
          </div>

          {/* Day cells */}
          {days.map((d, di) => {
            const dayApps = appointments.filter(a =>
              a.status !== 'cancelled' && a.stylist_id === stylist.id && isSameDay(parseISO(a.start_time), d)
            );
            return (
              <div key={di}
                className={`border-l p-1.5 min-h-[72px] cursor-pointer hover:bg-blue-50/30 transition-colors ${
                  isSameDay(d, today) ? 'bg-blue-50/10' : ''
                }`}
                onClick={() => onSlotClick(stylist.id, format(d, "yyyy-MM-dd'T'08:00:00+02:00"))}>
                {dayApps.map(app => {
                  const sc = sourceColors[app.source] || '#6b7280';
                  return (
                    <div key={app.id}
                      onClick={(e) => { e.stopPropagation(); onAppointmentClick(app); }}
                      className="rounded-lg px-2 py-1.5 mb-1 cursor-pointer hover:shadow-md transition-all duration-150 text-[11px] leading-tight border-l-[3px] bg-white shadow-sm"
                      style={{ borderLeftColor: sc }}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold truncate">
                          {app.client?.first_name} {app.client?.last_name?.[0]}.
                        </span>
                        <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1 rounded">
                          {format(parseISO(app.start_time), 'HH:mm')}
                        </span>
                      </div>
                      <div className="text-gray-500 truncate mt-0.5">{app.service?.name}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
