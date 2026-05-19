'use client';
import { format, setHours, setMinutes, parseISO, addMinutes } from 'date-fns';
import { AppointmentCard } from './AppointmentCard';
import type { Appointment, User, TimeBlock } from '@/lib/types';

interface Props {
  date: Date;
  stylists: Pick<User, 'id' | 'full_name'>[];
  appointments: Appointment[];
  timeBlocks: TimeBlock[];
  salonHours: { open: string; close: string };
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onDeleteBlock: (blockId: string) => void;
}

const STYLIST_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24'];

function isToday(d: Date): boolean {
  return format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
}

export function DayView({ date, stylists, appointments, timeBlocks, salonHours, onSlotClick, onAppointmentClick, onDeleteBlock }: Props) {
  const openH = parseInt(salonHours.open.split(':')[0]);
  const closeH = parseInt(salonHours.close.split(':')[0]);
  const hours = Array.from({ length: closeH - openH }, (_, i) => i + openH);
  const today = isToday(date);

  if (closeH <= openH) {
    return <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">Salone chiuso</div>;
  }

  if (stylists.length === 0) {
    return <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">Nessun operatore configurato</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] md:h-[calc(100vh-160px)] overflow-hidden bg-white rounded-none md:rounded-xl border-0 md:border shadow-sm">
      <div className="flex border-b bg-gray-50/50 sticky top-0 z-10 rounded-t-xl">
        <div className="w-14 flex-shrink-0 p-2" />
        {stylists.map((s, i) => (
          <div key={s.id} className="flex-1 p-3 text-center font-semibold text-sm border-l border-gray-100 flex items-center justify-center gap-2 bg-white/60">
            <div className="w-3 h-3 rounded-full ring-2 ring-offset-1 ring-gray-200" style={{ backgroundColor: STYLIST_COLORS[i % STYLIST_COLORS.length] }} />
            {s.full_name}
          </div>
        ))}
      </div>

      <div className="flex flex-1 overflow-auto">
        <div className="w-14 flex-shrink-0 bg-gray-50/30">
          {hours.map(h => (
            <div key={h} className={`h-20 border-b border-gray-100 text-[11px] text-gray-400 text-right pr-2 pt-0.5 font-medium ${
              today && new Date().getHours() === h ? 'bg-blue-50/50 text-blue-500' : ''
            }`}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {stylists.map(stylist => (
          <div key={stylist.id} className="flex-1 border-l border-gray-100">
            {hours.map(h => {
              const slotStart = setMinutes(setHours(date, h), 0);
              const slotEnd = addMinutes(slotStart, 60);
              const slotApps = appointments.filter(a => {
                if (a.status === 'cancelled') return false;
                const start = parseISO(a.start_time);
                return a.stylist_id === stylist.id && start >= slotStart && start < slotEnd;
              });
              const isBlocked = timeBlocks.some(b => {
                if (b.stylist_id && b.stylist_id !== stylist.id) return false;
                const bStart = parseISO(b.start_time);
                const bEnd = parseISO(b.end_time);
                return slotStart < bEnd && slotEnd > bStart;
              });
              const isCurrentHour = today && new Date().getHours() === h;
              const isPastHour = today && slotEnd < new Date();

              return (
                <div key={h}
                  className={`h-20 border-b border-gray-50 p-0.5 transition-colors group relative ${
                    isPastHour ? 'bg-gray-100/50 cursor-not-allowed opacity-40' :
                    isCurrentHour ? 'bg-blue-50/30 cursor-pointer' : 'hover:bg-gray-50/50 cursor-pointer'
                  } ${isBlocked ? 'bg-red-50/40' : ''}`}
                  onClick={() => {
                    if (isPastHour) return;
                    if (isBlocked) {
                      const block = timeBlocks.find(b => {
                        const bStart = parseISO(b.start_time); const bEnd = parseISO(b.end_time);
                        return b.stylist_id === stylist.id && slotStart < bEnd && slotEnd > bStart;
                      });
                      if (block && confirm('Rimuovere il blocco...?')) onDeleteBlock(block.id);
                    } else if (slotApps.length === 0) {
                      onSlotClick(stylist.id, format(slotStart, "yyyy-MM-dd'T'HH:mm:ssXXX"));
                    }
                  }}>

                  {isBlocked && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      <div className="w-full border-t-2 border-red-300 rotate-12" />
                      <span className="absolute text-[10px] text-red-400 font-medium bg-white/80 px-1 rounded">{(timeBlocks.find(b => { const bStart = parseISO(b.start_time); const bEnd = parseISO(b.end_time); return b.stylist_id === stylist.id && slotStart < bEnd && slotEnd > bStart; })?.reason) || 'Non disp.'}</span>
                    </div>
                  )}

                  {slotApps.map(app => (
                    <AppointmentCard key={app.id} appointment={app}
                      onClick={(e) => { e?.stopPropagation?.(); onAppointmentClick(app); }} />
                  ))}

                  {slotApps.length === 0 && !isBlocked && (
                    <div className="h-full flex items-center justify-center">
                      <span className="text-[10px] text-gray-300 border border-dashed border-gray-200 rounded px-2 py-1 opacity-60 group-hover:opacity-100 group-hover:border-blue-300 group-hover:text-blue-400 group-hover:bg-blue-50/50 transition-all">+ Prenota</span>
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
