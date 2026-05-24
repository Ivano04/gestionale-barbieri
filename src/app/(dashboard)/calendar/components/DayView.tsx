'use client';
import { useState, useRef, useCallback } from 'react';
import { format, setHours, setMinutes, parseISO, addMinutes, differenceInMinutes } from 'date-fns';
import type { Appointment, User, TimeBlock } from '@/lib/types';
import { toast } from 'sonner';

interface Props {
  date: Date;
  stylists: Pick<User, 'id' | 'full_name' | 'working_hours'>[];
  appointments: Appointment[];
  timeBlocks: TimeBlock[];
  salonHours: { open: string; close: string };
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onAppointmentMove: (appointmentId: string, newStylistId: string, newStartTime: string, newEndTime?: string) => Promise<{ warnings?: any[]; error?: string }>;
  onAppointmentResize: (appointmentId: string, newEndTime: string) => Promise<{ warnings?: any[]; error?: string }>;
  onDeleteBlock: (blockId: string) => void;
  onSwapRequest?: (appointmentId: string, targetStylistId: string) => void;
}

const STYLIST_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24'];
const HOUR_HEIGHT = 80; // px per hour
const MIN_HEIGHT = 44;  // min card height — ensures 2 lines of text fit

function isToday(d: Date): boolean {
  return format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
}

function getStylistHours(
  stylist: Pick<User, 'id' | 'full_name' | 'working_hours'>,
  salonHours: { open: string; close: string },
  date: Date
): { open: string; close: string } | null {
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayName = dayNames[date.getDay()];
  let swh = (stylist.working_hours || {}) as Record<string, any>;
  if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
  const stylistDay = swh?.[dayName];
  if (Object.keys(swh).length > 0 && stylistDay === null) return null;
  return {
    open: stylistDay?.open || salonHours.open,
    close: stylistDay?.close || salonHours.close,
  };
}

/** Convert time string "HH:MM" to minutes since midnight */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

const sourceConfig: Record<string, { bg: string; border: string }> = {
  walk_in:   { bg: '#ecfdf5', border: '#059669' },
  phone:     { bg: '#eff6ff', border: '#2563eb' },
  whatsapp:  { bg: '#f0fdfa', border: '#0d9488' },
  widget:    { bg: '#f5f3ff', border: '#7c3aed' },
  treatwell: { bg: '#fff7ed', border: '#ea580c' },
  google:    { bg: '#fef2f2', border: '#dc2626' },
  manual:    { bg: '#f9fafb', border: '#6b7280' },
};

export function DayView({ date, stylists, appointments, timeBlocks, salonHours, onSlotClick, onAppointmentClick, onAppointmentMove, onAppointmentResize, onDeleteBlock, onSwapRequest }: Props) {
  const today = isToday(date);
  const [dragState, setDragState] = useState<{
    appointmentId: string;
    startX: number;
    startY: number;
    origStylistId: string;
    origStartTime: string;
    origEndTime: string;
    currentStylistId: string;
    offsetY: number;
    mode: 'move' | 'resize';
  } | null>(null);
  const [resizeTarget, setResizeTarget] = useState<string | null>(null);
  const [conflictAppointments, setConflictAppointments] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute the earliest open and latest close across all stylists
  let globalOpen = 24 * 60;
  let globalClose = 0;
  stylists.forEach(st => {
    const h = getStylistHours(st, salonHours, date);
    if (!h) return;
    const open = timeToMinutes(h.open);
    const close = timeToMinutes(h.close);
    if (open < globalOpen) globalOpen = open;
    if (close > globalClose) globalClose = close;
  });
  if (globalClose <= globalOpen) {
    return <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">Salone chiuso</div>;
  }
  if (stylists.length === 0) {
    return <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">Nessun operatore configurato</div>;
  }

  const totalMinutes = globalClose - globalOpen;
  const totalHeight = (totalMinutes / 60) * HOUR_HEIGHT;

  function minuteToY(minute: number): number {
    return ((minute - globalOpen) / 60) * HOUR_HEIGHT;
  }

  function yToMinute(y: number): number {
    return Math.round((y / HOUR_HEIGHT) * 60 + globalOpen);
  }

  function snapMinute(minute: number): number {
    return Math.round(minute / 5) * 5; // snap to 5-min grid
  }

  // Build time labels
  const hourLabels: number[] = [];
  for (let h = Math.floor(globalOpen / 60); h <= Math.ceil(globalClose / 60); h++) {
    if (h * 60 >= globalOpen && h * 60 < globalClose) hourLabels.push(h);
  }

  // Pointer handlers for drag & resize
  function handlePointerDownCard(e: React.PointerEvent, app: Appointment, mode: 'move' | 'resize') {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setDragState({
      appointmentId: app.id,
      startX: e.clientX,
      startY: e.clientY,
      origStylistId: app.stylist_id!,
      origStartTime: app.start_time,
      origEndTime: app.end_time,
      currentStylistId: app.stylist_id!,
      offsetY: 0,
      mode,
    });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragState) return;
    const dy = e.clientY - dragState.startY;
    const minutesDelta = Math.round((dy / HOUR_HEIGHT) * 60);
    const snappedDelta = snapMinute(minutesDelta) - (snapMinute(minutesDelta) % 5);
    setDragState({ ...dragState, offsetY: dy });

    // Check which stylist column we're over (for cross-stylist move)
    if (dragState.mode === 'move' && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const relX = e.clientX - containerRect.left;
      const colWidth = (containerRect.width - 56) / stylists.length; // 56px time gutter
      const colIndex = Math.floor((relX - 56) / colWidth);
      if (colIndex >= 0 && colIndex < stylists.length) {
        setDragState(prev => ({ ...prev!, currentStylistId: stylists[colIndex].id }));
      }
    }
  }

  async function handlePointerUp(e: React.PointerEvent) {
    if (!dragState) return;
    const el = e.currentTarget as HTMLElement;
    el.releasePointerCapture?.(e.pointerId);

    const dy = e.clientY - dragState.startY;
    const minutesDelta = snapMinute(Math.round((dy / HOUR_HEIGHT) * 60));

    if (Math.abs(minutesDelta) < 5 && dragState.currentStylistId === dragState.origStylistId) {
      // No significant movement — treat as click
      setDragState(null);
      return;
    }

    const origStart = parseISO(dragState.origStartTime);

    if (dragState.mode === 'move') {
      const newStart = addMinutes(origStart, minutesDelta);
      const newStartStr = newStart.toISOString();

      try {
        const res = await onAppointmentMove(
          dragState.appointmentId,
          dragState.currentStylistId,
          newStartStr,
        );
        if (res.error) {
          toast.error(res.error);
          if (res.warnings?.length) {
            res.warnings.forEach((w: any) => toast.warning(w.message));
          }
        } else if (res.warnings?.length) {
          toast.warning('Attenzione: sovrapposizione con fase di posa');
        } else {
          toast.success('Appuntamento spostato');
        }
      } catch {
        toast.error('Errore spostamento');
      }
    } else if (dragState.mode === 'resize') {
      const origEnd = parseISO(dragState.origEndTime);
      const newEnd = addMinutes(origEnd, minutesDelta);
      const newEndStr = newEnd.toISOString();

      try {
        const res = await onAppointmentResize(dragState.appointmentId, newEndStr);
        if (res.error) {
          toast.error(res.error);
          if (res.warnings?.length) {
            res.warnings.forEach((w: any) => toast.warning(w.message));
          }
        } else if (res.warnings?.length) {
          toast.warning('Attenzione: estensione invade un altro appuntamento');
        } else {
          toast.success('Durata aggiornata');
        }
      } catch {
        toast.error('Errore ridimensionamento');
      }
    }

    setDragState(null);
  }

  const activeApps = appointments.filter(a => a.status !== 'cancelled');

  // Build per-stylist appointment positioning
  function getAppointmentStyle(app: Appointment): React.CSSProperties | null {
    const start = parseISO(app.start_time);
    const end = parseISO(app.end_time);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const top = minuteToY(startMin);
    const h = Math.max(MIN_HEIGHT, minuteToY(endMin) - top);
    return { top: `${top}px`, height: `${h}px`, position: 'absolute', left: '2px', right: '2px' };
  }

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] md:h-[calc(100vh-160px)] overflow-hidden bg-white rounded-none md:rounded-xl border-0 md:border shadow-sm">
      {/* Header */}
      <div className="flex border-b bg-gray-50/50 sticky top-0 z-10 rounded-t-xl" style={{ minHeight: '48px' }}>
        <div className="w-14 flex-shrink-0 p-2" />
        {stylists.map((s, i) => (
          <div key={s.id} className="flex-1 p-3 text-center font-semibold text-sm border-l border-gray-100 flex items-center justify-center gap-2 bg-white/60">
            <div className="w-3 h-3 rounded-full ring-2 ring-offset-1 ring-gray-200" style={{ backgroundColor: STYLIST_COLORS[i % STYLIST_COLORS.length] }} />
            {s.full_name}
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-auto" ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ touchAction: 'none' }}>
        {/* Time gutter */}
        <div className="w-14 flex-shrink-0 bg-gray-50/30 relative" style={{ height: `${totalHeight}px` }}>
          {hourLabels.map(h => (
            <div key={h} className="absolute left-0 right-0 text-[11px] text-gray-400 text-right pr-2 font-medium"
              style={{ top: `${minuteToY(h * 60)}px` }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
          {/* Current time indicator */}
          {today && (() => {
            const now = new Date();
            const nowMin = now.getHours() * 60 + now.getMinutes();
            if (nowMin < globalOpen || nowMin > globalClose) return null;
            return <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: `${minuteToY(nowMin)}px` }}>
              <div className="border-t-2 border-red-400 w-full" />
              <div className="w-2 h-2 rounded-full bg-red-500 -mt-1 -ml-1" />
            </div>;
          })()}
        </div>

        {/* Stylist columns */}
        {stylists.map((stylist, si) => {
          const stHours = getStylistHours(stylist, salonHours, date);
          if (stHours === null) {
            return (
              <div key={stylist.id} className="flex-1 border-l border-gray-100 relative" style={{ height: `${totalHeight}px` }}>
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Giorno libero</div>
              </div>
            );
          }

          const stOpen = timeToMinutes(stHours.open);
          const stClose = timeToMinutes(stHours.close);

          // Get appointments for this stylist
          const stApps = activeApps.filter(a => a.stylist_id === stylist.id);
          const stBlocks = timeBlocks.filter(b => !b.stylist_id || b.stylist_id === stylist.id);

          return (
            <div key={stylist.id} className="flex-1 border-l border-gray-100 relative bg-white"
              style={{ height: `${totalHeight}px` }}>
              {/* Hour grid lines */}
              {hourLabels.map(h => (
                <div key={h} className="absolute left-0 right-0 border-b border-gray-50 pointer-events-none"
                  style={{ top: `${minuteToY(h * 60)}px`, height: `${HOUR_HEIGHT}px` }} />
              ))}

              {/* Off-hours shading */}
              {stOpen > globalOpen && (
                <div className="absolute left-0 right-0 bg-gray-100/50 pointer-events-none z-0"
                  style={{ top: 0, height: `${minuteToY(stOpen)}px` }} />
              )}
              {stClose < globalClose && (
                <div className="absolute left-0 right-0 bg-gray-100/50 pointer-events-none z-0"
                  style={{ top: `${minuteToY(stClose)}px`, bottom: 0 }} />
              )}

              {/* Time blocks */}
              {stBlocks.map(b => {
                const bStart = parseISO(b.start_time);
                const bEnd = parseISO(b.end_time);
                const bStartMin = bStart.getHours() * 60 + bStart.getMinutes();
                const bEndMin = bEnd.getHours() * 60 + bEnd.getMinutes();
                const top = minuteToY(Math.max(bStartMin, stOpen));
                const h = minuteToY(Math.min(bEndMin, stClose)) - top;
                if (h <= 0) return null;
                return (
                  <div key={b.id} className="absolute left-1 right-1 z-10 flex items-center justify-center rounded-md cursor-pointer group"
                    style={{ top: `${top}px`, height: `${Math.max(h, 20)}px`, backgroundColor: '#fef2f2' }}
                    onClick={() => {
                      if (confirm(`Rimuovere il blocco${b.reason ? ` "${b.reason}"` : ''}?`)) onDeleteBlock(b.id);
                    }}>
                    <div className="w-full border-t-2 border-red-300 rotate-12 absolute" />
                    <span className="text-[10px] text-red-400 font-medium bg-white/80 px-1 rounded relative z-10">
                      {b.reason || 'Non disp.'}
                    </span>
                  </div>
                );
              })}

              {/* Appointments */}
              {stApps.map(app => {
                const style = getAppointmentStyle(app);
                if (!style) return null;
                const cfg = sourceConfig[app.source] || sourceConfig.manual;
                const isDragging = dragState?.appointmentId === app.id;
                const isConflicting = conflictAppointments.has(app.id);
                const hasBuffer = app.buffer_end_time && app.buffer_end_time !== app.end_time;

                const cardHeight = parseFloat(style?.height as string) || MIN_HEIGHT;
                return (
                  <div key={app.id}
                    className={`absolute left-1 right-1 rounded-lg px-1.5 py-0.5 cursor-pointer transition-shadow z-10 border-l-[3px] text-xs overflow-hidden flex flex-col
                      ${isDragging ? 'opacity-70 shadow-xl z-30 ring-2 ring-blue-400 scale-[1.02]' : 'hover:shadow-md'}
                      ${isConflicting ? 'ring-2 ring-red-400 border-red-500' : ''}`}
                    style={{
                      ...style,
                      borderLeftColor: cfg.border,
                      backgroundColor: cfg.bg,
                      touchAction: 'none',
                    }}
                    onClick={(e) => {
                      if (dragState) return;
                      e.stopPropagation();
                      onAppointmentClick(app);
                    }}
                    onPointerDown={(e) => handlePointerDownCard(e, app, 'move')}>
                    <div className="flex items-center justify-between gap-1 leading-tight">
                      <span className="font-medium truncate text-[10px]">
                        {app.client?.first_name} {app.client?.last_name || ''}
                      </span>
                      <span className="text-[9px] text-gray-400 flex-shrink-0">
                        {format(parseISO(app.start_time), 'HH:mm')}
                      </span>
                    </div>
                    <div className="text-gray-500 truncate text-[9px] leading-tight">{app.service?.name}</div>
                    {app.service?.price_cents != null && cardHeight >= 38 && (
                      <div className="text-[9px] font-medium text-green-600 leading-tight">€{(app.service.price_cents / 100).toFixed(0)}</div>
                    )}

                    {/* Buffer indicator */}
                    {hasBuffer && (
                      <div className="absolute left-0 right-0 bottom-0 h-1.5 bg-gray-300/50 rounded-b-md border-t border-dashed border-gray-400"
                        title="Tempo buffer (pulizia)" />
                    )}

                    {/* Conflict indicator */}
                    {isConflicting && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold">!</div>
                    )}

                    {/* Resize handle */}
                    <div
                      className="absolute left-0 right-0 bottom-0 h-2 cursor-s-resize hover:bg-blue-200/50 rounded-b-md"
                      onPointerDown={(e) => handlePointerDownCard(e, app, 'resize')}
                      title="Trascina per estendere" />
                  </div>
                );
              })}

              {/* Empty slot click area */}
              <div className="absolute inset-0 z-0"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const minute = snapMinute(yToMinute(y));
                  const h = Math.floor(minute / 60);
                  const m = minute % 60;
                  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
                  onSlotClick(stylist.id, format(date, `yyyy-MM-dd`) + `T${timeStr}+02:00`);
                }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
