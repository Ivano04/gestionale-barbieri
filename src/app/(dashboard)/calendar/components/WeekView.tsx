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

const sourceBg: Record<string, string> = {
  walk_in: '#ecfdf5', phone: '#eff6ff', whatsapp: '#f0fdfa', widget: '#f5f3ff',
  treatwell: '#fff7ed', google: '#fef2f2', manual: '#f9fafb',
};
const sourceBorder: Record<string, string> = {
  walk_in: '#059669', phone: '#2563eb', whatsapp: '#0d9488', widget: '#7c3aed',
  treatwell: '#ea580c', google: '#dc2626', manual: '#6b7280',
};

export function WeekView({ date, stylists, appointments, onSlotClick, onAppointmentClick }: Props) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  if (stylists.length === 0) {
    return <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">Nessun operatore configurato</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] overflow-auto bg-white rounded-xl border shadow-sm">
      {/* Header: days */}
      <div className="flex border-b bg-gray-50/50 sticky top-0 z-10 rounded-t-xl">
        <div className="w-28 flex-shrink-0 p-3 text-xs font-medium text-gray-400 border-r">
          Operatore
        </div>
        {days.map((d, i) => (
          <div key={i} className={`flex-1 p-3 text-center border-r last:border-r-0 ${
            isSameDay(d, new Date()) ? 'bg-blue-50/50' : ''
          }`}>
            <div className="text-xs text-gray-400">{format(d, 'EEE', { locale: it })}</div>
            <div className={`font-semibold text-sm ${isSameDay(d, new Date()) ? 'text-blue-600' : ''}`}>
              {format(d, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* Rows: one per stylist */}
      <div className="flex-1 overflow-auto">
        {stylists.map((stylist, si) => (
          <div key={stylist.id} className="flex border-b last:border-b-0 hover:bg-gray-50/30">
            <div className="w-28 flex-shrink-0 p-3 border-r flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full ring-1 ring-offset-1 ring-gray-300 flex-shrink-0"
                style={{ backgroundColor: STYLIST_COLORS[si % STYLIST_COLORS.length] }} />
              <span className="text-sm font-medium truncate">{stylist.full_name}</span>
            </div>
            {days.map((d, di) => {
              const dayApps = appointments.filter(a => {
                const start = parseISO(a.start_time);
                return a.stylist_id === stylist.id && isSameDay(start, d);
              });
              return (
                <div key={di}
                  className="flex-1 border-r last:border-r-0 p-1 min-h-[60px] cursor-pointer hover:bg-blue-50/20 transition-colors"
                  onClick={() => onSlotClick(stylist.id, format(d, "yyyy-MM-dd'T'08:00:00+02:00"))}>
                  {dayApps.map(app => {
                    const src = app.source || 'manual';
                    return (
                      <div key={app.id}
                        onClick={(e) => { e.stopPropagation(); onAppointmentClick(app); }}
                        className="rounded px-1.5 py-0.5 mb-0.5 text-[10px] cursor-pointer hover:shadow-sm transition-shadow border-l-2 truncate"
                        style={{ borderLeftColor: sourceBorder[src] || '#6b7280', backgroundColor: sourceBg[src] || '#f9fafb' }}>
                        <span className="font-medium">{app.client?.first_name?.[0]}{app.client?.last_name?.[0] || ''}</span>
                        {' '}{app.service?.name?.substring(0, 10)}
                        <span className="text-gray-400 ml-1">
                          {format(parseISO(app.start_time), 'HH:mm')}
                        </span>
                      </div>
                    );
                  })}
                  {dayApps.length === 0 && (
                    <div className="h-full flex items-center justify-center opacity-0 hover:opacity-100">
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
