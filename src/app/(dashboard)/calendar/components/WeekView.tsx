'use client';
import { useState } from 'react';
import { format, startOfWeek, addDays, parseISO, isSameDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { toast } from 'sonner';
import type { Appointment, User, TimeBlock } from '@/lib/types';
import { buildSlotTime } from '@/lib/date-utils';
import { normalizeShifts } from '@/lib/working-hours';

interface Props {
  date: Date;
  stylists: Pick<User, 'id' | 'full_name' | 'working_hours'>[];
  appointments: Appointment[];
  timeBlocks: TimeBlock[];
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onAppointmentMove: (appointmentId: string, newStylistId: string, newStartTime: string) => Promise<{ warnings?: any[]; error?: string }>;
  onDeleteBlock: (blockId: string) => void;
}

const STYLIST_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24'];

const sourceColors: Record<string, string> = {
  walk_in: '#059669', phone: '#2563eb', whatsapp: '#0d9488', widget: '#7c3aed',
  treatwell: '#ea580c', google: '#dc2626', manual: '#6b7280',
};

export function WeekView({ date, stylists, appointments, timeBlocks, onSlotClick, onAppointmentClick, onAppointmentMove, onDeleteBlock }: Props) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  const [dragApp, setDragApp] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  function isDayOff(stylist: typeof stylists[0], d: Date): boolean {
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayName = dayNames[d.getDay()];
    let swh = (stylist.working_hours || {}) as Record<string, any>;
    if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
    const dayValue = swh?.[dayName];
    // Explicitly null or empty array → day off
    if (Object.keys(swh).length > 0 && dayValue === null) return true;
    const shifts = normalizeShifts(dayValue);
    return shifts === null || shifts.length === 0;
  }

  if (stylists.length === 0) {
    return <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">Nessun operatore configurato</div>;
  }

  async function handleDrop(stylistId: string, day: Date) {
    if (!dragApp) return;
    const app = appointments.find(a => a.id === dragApp);
    if (!app) return;

    const currentStart = parseISO(app.start_time);
    const newDay = format(day, 'yyyy-MM-dd');
    const currentTime = format(currentStart, 'HH:mm');
    const newStartTime = buildSlotTime(newDay, currentTime);

    try {
      const res = await onAppointmentMove(dragApp, stylistId, newStartTime);
      if (res.error) {
        toast.error(res.error);
      } else if (res.warnings?.length) {
        toast.warning('Attenzione: sovrapposizione');
      } else {
        toast.success('Appuntamento spostato');
      }
    } catch {
      toast.error('Errore spostamento');
    }
    setDragApp(null);
    setDragOverCell(null);
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
          </div>
          {days.map((d, di) => {
            const dayOff = isDayOff(stylist, d);
            const isPastDay = d < new Date(new Date().toDateString());
            const dayApps = appointments.filter(a =>
              a.status !== 'cancelled' && a.stylist_id === stylist.id && isSameDay(parseISO(a.start_time), d)
            );
            const dayBlocked = timeBlocks.some(b => {
              if (b.stylist_id && b.stylist_id !== stylist.id) return false;
              return isSameDay(parseISO(b.start_time), d) || isSameDay(parseISO(b.end_time), d);
            });
            const cellKey = `${stylist.id}-${di}`;
            const isDragOver = dragOverCell === cellKey;

            return (
              <div key={di}
                className={`border-l p-1.5 min-h-[80px] transition-colors ${
                  dayOff || isPastDay ? 'bg-gray-100/70 cursor-not-allowed opacity-40' :
                  isDragOver ? 'bg-blue-100 ring-2 ring-blue-400 z-10' :
                  dayBlocked ? 'bg-red-50/30 cursor-pointer' :
                  isSameDay(d, today) ? 'bg-blue-50/10 cursor-pointer' :
                  'hover:bg-gray-50/50 cursor-pointer'
                }`}
                onClick={() => {
                  if (dayOff || isPastDay) return;
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
                }}
                onDragOver={(e) => {
                  if (dayOff || isPastDay) return;
                  e.preventDefault();
                  setDragOverCell(cellKey);
                }}
                onDragLeave={() => setDragOverCell(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(stylist.id, d);
                }}>
                {dayOff && (
                  <div className="text-[10px] text-gray-400 text-center py-4">Riposo</div>
                )}
                {!dayOff && dayApps.map(app => {
                  const sc = sourceColors[app.source] || '#6b7280';
                  return (
                    <div key={app.id}
                      draggable
                      onDragStart={() => setDragApp(app.id)}
                      onDragEnd={() => { setDragApp(null); setDragOverCell(null); }}
                      onClick={(e) => { e.stopPropagation(); onAppointmentClick(app); }}
                      className={`rounded-lg px-2 py-1.5 mb-1 cursor-pointer hover:shadow-md transition-all duration-150 border-l-[3px] bg-white shadow-sm ${dragApp === app.id ? 'opacity-50 ring-2 ring-blue-400' : ''}`}
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
                      {/* Buffer indicator */}
                      {app.buffer_end_time && app.buffer_end_time !== app.end_time && (
                        <div className="mt-1 h-1 bg-gray-300/50 rounded-full" title="Con buffer" />
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
