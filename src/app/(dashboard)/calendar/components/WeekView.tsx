'use client';
import { format, startOfWeek, addDays, parseISO, isSameDay } from 'date-fns';
import { it } from 'date-fns/locale';
import type { Appointment, User, TimeBlock } from '@/lib/types';
import { buildSlotTime } from '@/lib/date-utils';

interface Props {
  date: Date;
  stylists: Pick<User, 'id' | 'full_name' | 'working_hours'>[];
  appointments: Appointment[];
  timeBlocks: TimeBlock[];
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onDeleteBlock: (blockId: string) => void;
}

const STYLIST_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24'];

const sourceColors: Record<string, string> = {
  walk_in: '#059669', phone: '#2563eb', whatsapp: '#0d9488', widget: '#7c3aed',
  treatwell: '#ea580c', google: '#dc2626', manual: '#6b7280',
};

export function WeekView({ date, stylists, appointments, timeBlocks, onSlotClick, onAppointmentClick, onDeleteBlock }: Props) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  function isDayOff(stylist: typeof stylists[0], d: Date): boolean {
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayName = dayNames[d.getDay()];
    let swh = (stylist.working_hours || {}) as Record<string, any>;
    if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
    return Object.keys(swh).length > 0 && swh?.[dayName] === null;
  }

  if (stylists.length === 0) {
    return <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">Nessun operatore configurato</div>;
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-8 border-b bg-gray-50/50">
        <div className="p-3 flex items-end"><span className="text-xs font-medium text-gray-400">Operatore</span></div>
        {days.map((d, i) => (
          <div key={i} className={`p-3 text-center border-l ${isSameDay(d, today) ? 'bg-blue-50/30' : ''}`}>
            <div className="text-[11px] text-gray-400 font-medium">{format(d, 'EEE', { locale: it })}</div>
            <div className={`text-xl font-bold ${isSameDay(d, today) ? 'text-blue-600' : 'text-gray-700'}`}>{format(d, 'd')}</div>
          </div>
        ))}
      </div>

      {/* Rows */}
      {stylists.map((stylist, si) => (
        <div key={stylist.id} className="grid grid-cols-8 border-b last:border-b-0 hover:bg-gray-50/30 transition-colors">
          <div className="p-3 flex items-center gap-2 border-r bg-gray-50/30">
            <div className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-offset-1 ring-gray-200"
              style={{ backgroundColor: STYLIST_COLORS[si % STYLIST_COLORS.length] }} />
            <span className="text-sm font-semibold text-gray-700 truncate">{stylist.full_name.split(' ')[0]}</span>
            <span className="text-xs text-gray-400 ml-auto">{appointments.filter(a => a.stylist_id === stylist.id && a.status !== 'cancelled' && isSameDay(parseISO(a.start_time), weekStart) || isSameDay(parseISO(a.start_time), addDays(weekStart, 1))).length || ''}</span>
          </div>
          {days.map((d, di) => {
            const dayOff = isDayOff(stylist, d);
            const dayApps = appointments.filter(a =>
              a.status !== 'cancelled' && a.stylist_id === stylist.id && isSameDay(parseISO(a.start_time), d)
            );
            const dayBlocked = timeBlocks.some(b => {
              if (b.stylist_id && b.stylist_id !== stylist.id) return false;
              return isSameDay(parseISO(b.start_time), d) || isSameDay(parseISO(b.end_time), d);
            });
            return (
              <div key={di}
                className={`border-l p-1.5 min-h-[80px] ${
                  dayOff ? 'bg-gray-100/70 cursor-default' :
                  dayBlocked ? 'bg-red-50/30 cursor-pointer' :
                  isSameDay(d, today) ? 'bg-blue-50/10 cursor-pointer' :
                  'hover:bg-gray-50/50 cursor-pointer'
                }`}
                onClick={() => {
                  if (dayOff) return;
                  if (dayBlocked) {
                    const block = timeBlocks.find(b => {
                      if (b.stylist_id && b.stylist_id !== stylist.id) return false;
                      return isSameDay(parseISO(b.start_time), d) || isSameDay(parseISO(b.end_time), d);
                    });
                    if (block && confirm(`Rimuovere il blocco${block.reason ? ` "${block.reason}"` : ''}?`)) {
                      onDeleteBlock(block.id);
                    }
                  } else {
                    onSlotClick(stylist.id, buildSlotTime(format(d, 'yyyy-MM-dd'), '08:00'));
                  }
                }}>
                {dayOff && (
                  <div className="text-[10px] text-gray-400 text-center py-4">Riposo</div>
                )}
                {!dayOff && dayApps.map(app => {
                  const sc = sourceColors[app.source] || '#6b7280';
                  return (
                    <div key={app.id}
                      onClick={(e) => { e.stopPropagation(); onAppointmentClick(app); }}
                      className="rounded-lg px-2 py-1.5 mb-1 cursor-pointer hover:shadow-md transition-all duration-150 border-l-[3px] bg-white shadow-sm"
                      style={{ borderLeftColor: sc }}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-[11px] truncate">
                          {app.client?.first_name}
                        </span>
                        <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1 rounded">
                          {format(parseISO(app.start_time), 'HH:mm')}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 truncate mt-0.5">{app.service?.name}</div>
                      {app.service?.price_cents && (
                        <div className="text-[10px] font-medium text-green-600">€{(app.service.price_cents / 100).toFixed(0)}</div>
                      )}
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
