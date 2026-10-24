'use client';
import { appointmentServiceName } from '@/lib/booking-services';
import { financeDescription, matchesFinanceFilter, paymentAppearance, type FinanceFilter } from '@/lib/calendar-finance';
import { FinancialStatus, BookingSource } from './FinancialStatus';
import { useState, useRef, useCallback } from 'react';
import { format, setHours, setMinutes, parseISO, addMinutes, differenceInMinutes } from 'date-fns';
import type { Appointment, User, TimeBlock } from '@/lib/types';
import { normalizeShifts, shiftBounds, type WorkingHoursShift } from '@/lib/working-hours';
import { toast } from 'sonner';

interface Props {
  date: Date;
  stylists: Pick<User, 'id' | 'full_name' | 'working_hours'>[];
  appointments: Appointment[];
  financeFilter?: FinanceFilter;
  timeBlocks: TimeBlock[];
  salonShifts: WorkingHoursShift[];
  salonHours: { open: string; close: string };
  onSlotClick: (stylistId: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onAppointmentMove: (appointmentId: string, newStylistId: string, newStartTime: string, newEndTime?: string) => Promise<{ warnings?: any[]; error?: string }>;
  onAppointmentResize: (appointmentId: string, newEndTime: string) => Promise<{ warnings?: any[]; error?: string }>;
  onDeleteBlock: (blockId: string) => void;
  onSwapRequest?: (appointmentId: string, targetStylistId: string) => void;
}

const STYLIST_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24'];
const HOUR_HEIGHT = 160; // px per hour — 15min = 40px, griglia a quarti d'ora
const MIN_HEIGHT = 30;  // ensures back-to-back 15min slots don't overlap

function isToday(d: Date): boolean {
  return format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
}

function getStylistShifts(
  stylist: Pick<User, 'id' | 'full_name' | 'working_hours'>,
  salonShifts: WorkingHoursShift[],
  date: Date
): WorkingHoursShift[] | null {
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayName = dayNames[date.getDay()];
  let swh = (stylist.working_hours || {}) as Record<string, any>;
  if (typeof swh === 'string') try { swh = JSON.parse(swh); } catch {}
  const stylistDay = swh?.[dayName];
  // Explicitly null = day off
  if (Object.keys(swh).length > 0 && stylistDay === null) return null;
  // Normalize to multi-shift; fallback to salon shifts
  return normalizeShifts(stylistDay) || salonShifts;
}

/** Convert time string "HH:MM" to minutes since midnight */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}


export function DayView({ date, stylists, appointments, financeFilter = 'all', timeBlocks, salonShifts, salonHours, onSlotClick, onAppointmentClick, onAppointmentMove, onAppointmentResize, onDeleteBlock, onSwapRequest }: Props) {
  const today = isToday(date);
  const [dragState, setDragState] = useState<{
    appointmentId: string;
    pointerId: number;
    scrollTop: number;
    startX: number;
    startY: number;
    origStylistId: string;
    origStartTime: string;
    origEndTime: string;
    currentStylistId: string;
    offsetY: number;
    offsetX: number;
    mode: 'move' | 'resize';
  } | null>(null);
  const gesture = useRef<typeof dragState>(null);
  const captureOwner = useRef<HTMLElement | null>(null);
  const savingMove = useRef(false);
  const suppressClick = useRef(false);
  const [resizeTarget, setResizeTarget] = useState<string | null>(null);
  const [conflictAppointments, setConflictAppointments] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const activeApps = appointments.filter(a => a.status !== 'cancelled');

  // Compute the earliest open and latest close across all stylists' shifts,
  // including appointments on off-duty stylists (manual admin assignments)
  let globalOpen = 24 * 60;
  let globalClose = 0;
  stylists.forEach(st => {
    const shifts = getStylistShifts(st, salonShifts, date);
    if (!shifts) {
      // Off-duty stylist: expand bounds to include their appointments
      for (const a of activeApps) {
        if (a.stylist_id !== st.id) continue;
        const s = parseISO(a.start_time);
        const e = parseISO(a.end_time);
        const sm = s.getHours() * 60 + s.getMinutes();
        const em = e.getHours() * 60 + e.getMinutes();
        if (sm < globalOpen) globalOpen = sm;
        if (em > globalClose) globalClose = em;
      }
      return;
    }
    const bounds = shiftBounds(shifts);
    const open = timeToMinutes(bounds.open);
    const close = timeToMinutes(bounds.close);
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
    return Math.round(minute / 15) * 15; // snap a quarti d'ora
  }

  // Build time labels
  const hourLabels: number[] = [];
  for (let h = Math.floor(globalOpen / 60); h <= Math.ceil(globalClose / 60); h++) {
    if (h * 60 >= globalOpen && h * 60 < globalClose) hourLabels.push(h);
  }

  // Keep the active gesture synchronously available to the release handler.
  function handlePointerDownCard(e: React.PointerEvent, app: Appointment, mode: 'move' | 'resize') {
    if (e.button !== 0 || !e.isPrimary || savingMove.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick.current = false;
    captureOwner.current = e.currentTarget as HTMLElement;
    captureOwner.current.setPointerCapture(e.pointerId);
    const next = {
      appointmentId: app.id, pointerId: e.pointerId,
      scrollTop: containerRef.current?.scrollTop ?? 0,
      startX: e.clientX, startY: e.clientY,
      origStylistId: app.stylist_id!, currentStylistId: app.stylist_id!,
      origStartTime: app.start_time, origEndTime: app.end_time,
      offsetY: 0, offsetX: 0, mode,
    };
    gesture.current = next;
    setDragState(next);
  }

  function positionAt(e: React.PointerEvent, current: NonNullable<typeof dragState>) {
    let stylistId = current.origStylistId;
    if (current.mode === 'move') {
      const columns = containerRef.current?.querySelectorAll<HTMLElement>('[data-stylist-id]') ?? [];
      for (const column of columns) {
        const bounds = column.getBoundingClientRect();
        if (e.clientX >= bounds.left && e.clientX < bounds.right) {
          stylistId = column.dataset.stylistId!;
          break;
        }
      }
    }
    return { ...current, currentStylistId: stylistId,
      offsetX: e.clientX - current.startX,
      offsetY: e.clientY - current.startY + (containerRef.current?.scrollTop ?? 0) - current.scrollTop };
  }

  function releaseCapture(pointerId: number) {
    if (captureOwner.current?.hasPointerCapture(pointerId)) captureOwner.current.releasePointerCapture(pointerId);
    captureOwner.current = null;
  }

  function cancelGesture(e: React.PointerEvent) {
    if (gesture.current?.pointerId !== e.pointerId) return;
    gesture.current = null;
    suppressClick.current = true;
    releaseCapture(e.pointerId);
    setDragState(null);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!gesture.current || gesture.current.pointerId !== e.pointerId) return;
    const next = positionAt(e, gesture.current);
    gesture.current = next;
    setDragState(next);
  }

  async function handlePointerUp(e: React.PointerEvent) {
    if (!gesture.current || gesture.current.pointerId !== e.pointerId) return;
    const current = positionAt(e, gesture.current);
    gesture.current = null;
    releaseCapture(e.pointerId);
    const minutesDelta = snapMinute(Math.round((current.offsetY / HOUR_HEIGHT) * 60));
    const moved = minutesDelta !== 0 || (current.mode === 'move' && current.currentStylistId !== current.origStylistId);
    suppressClick.current = moved;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!moved || !bounds || e.clientX < bounds.left + 56 || e.clientX >= bounds.right || e.clientY < bounds.top || e.clientY >= bounds.bottom) {
      setDragState(null);
      return;
    }
    savingMove.current = true;
    setDragState(current);
    try {
      const newEnd = addMinutes(parseISO(current.origEndTime), minutesDelta).toISOString();
      const result = current.mode === 'move'
        ? await onAppointmentMove(current.appointmentId, current.currentStylistId,
            addMinutes(parseISO(current.origStartTime), minutesDelta).toISOString(), newEnd)
        : await onAppointmentResize(current.appointmentId, newEnd);
      if (result.error) toast.error(result.error);
      else if (result.warnings?.length) toast.warning(result.warnings[0].message || 'Verifica le sovrapposizioni');
      else toast.success(current.mode === 'move' ? 'Appuntamento spostato' : 'Durata aggiornata');
    } catch {
      toast.error('Impossibile salvare lo spostamento. Riprova.');
    } finally {
      savingMove.current = false;
      setDragState(null);
    }
  }

  // ── Layout collision-aware (effetto "stretch" come Treatwell) ──
  /** Assegna colonne agli appuntamenti sovrapposti di uno stylist.
   *  Solo gli appuntamenti che effettivamente si sovrappongono condividono colonne. */
  function computeColumns(apps: Appointment[]): Map<string, { col: number; total: number }> {
    const sorted = [...apps].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    const result = new Map<string, { col: number; total: number }>();

    // Raggruppa in cluster di sovrapposizione
    let i = 0;
    while (i < sorted.length) {
      const cluster: Appointment[] = [sorted[i]];
      let clusterEnd = new Date(sorted[i].end_time);
      let j = i + 1;
      while (j < sorted.length && new Date(sorted[j].start_time) < clusterEnd) {
        cluster.push(sorted[j]);
        const jEnd = new Date(sorted[j].end_time);
        if (jEnd > clusterEnd) clusterEnd = jEnd;
        j++;
      }

      // Per questo cluster, assegna colonne
      if (cluster.length === 1) {
        result.set(cluster[0].id, { col: 0, total: 1 });
      } else {
        // Algoritmo greedy: prova a piazzare in una colonna esistente
        const columns: { end: Date; appId: string }[][] = [];
        for (const app of cluster) {
          const appStart = new Date(app.start_time);
          let placed = false;
          for (let c = 0; c < columns.length; c++) {
            const lastInCol = columns[c][columns[c].length - 1];
            if (appStart >= lastInCol.end) {
              columns[c].push({ end: new Date(app.end_time), appId: app.id });
              placed = true;
              break;
            }
          }
          if (!placed) {
            columns.push([{ end: new Date(app.end_time), appId: app.id }]);
          }
        }
        const total = columns.length;
        for (let c = 0; c < total; c++) {
          for (const entry of columns[c]) {
            result.set(entry.appId, { col: c, total });
          }
        }
      }

      i = j;
    }

    return result;
  }

  // Per-stylist column map
  const columnMap = new Map<string, Map<string, { col: number; total: number }>>();
  for (const stylist of stylists) {
    const stApps = activeApps.filter(a => a.stylist_id === stylist.id);
    if (stApps.length > 0) {
      columnMap.set(stylist.id, computeColumns(stApps));
    }
  }

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
        onPointerCancel={cancelGesture}
        onLostPointerCapture={cancelGesture}
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
          const stShifts = getStylistShifts(stylist, salonShifts, date);
          const stApps = activeApps.filter(a => a.stylist_id === stylist.id);
          const stBlocks = timeBlocks.filter(b => !b.stylist_id || b.stylist_id === stylist.id);
          const isOff = stShifts === null || stShifts.length === 0;

          // Renderizza le card appuntamento (usato sia per colonne normali che off-duty)
          function renderAppointmentCards() {
            return stApps.filter(app => matchesFinanceFilter(app.finance, financeFilter)).map(app => {
              const style = getAppointmentStyle(app);
              if (!style) return null;
              const cfg = paymentAppearance[app.finance?.payment ?? 'unknown'];
              const isDragging = dragState?.appointmentId === app.id;
              const isConflicting = conflictAppointments.has(app.id);
              const hasBuffer = app.buffer_end_time && app.buffer_end_time !== app.end_time;

              const cols = columnMap.get(stylist.id)?.get(app.id);
              const colWidth = cols && cols.total > 1 ? `${100 / cols.total}%` : undefined;
              const colLeft = cols && cols.total > 1 ? `${(cols.col / cols.total) * 100}%` : undefined;

              const cardHeight = parseFloat(style?.height as string) || MIN_HEIGHT;
              const isResizing = isDragging && dragState.mode === 'resize';
              return (
                <div key={app.id} data-appointment-id={app.id} role="button" tabIndex={0}
                  title={financeDescription(app.finance)}
                  aria-label={`${app.client?.first_name ?? 'Cliente'} ${app.client?.last_name ?? ''}, ${format(parseISO(app.start_time), 'HH:mm')}, ${financeDescription(app.finance)}`}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAppointmentClick(app); } }}
                  className={`absolute rounded-lg px-1.5 py-0.5 cursor-pointer z-10 border-l-[3px] text-xs overflow-hidden flex flex-col focus-visible:outline-2 focus-visible:outline-blue-600
                    ${isDragging ? 'opacity-70 shadow-xl z-30 ring-2 ring-blue-400 scale-[1.02]' : 'hover:shadow-md transition-shadow'}
                    ${isConflicting ? 'ring-2 ring-red-400 border-red-500' : ''}`}
                  style={{
                    ...style,
                    left: colLeft || '2px',
                    width: colWidth ? `calc(${colWidth} - 4px)` : undefined,
                    right: colLeft ? undefined : '2px',
                    borderLeftColor: cfg.border,
                    backgroundColor: cfg.bg,
                    touchAction: 'none',
                    height: isResizing ? `${Math.max(MIN_HEIGHT, cardHeight + dragState.offsetY)}px` : style.height,
                    transform: isDragging && !isResizing ? `translate(${dragState.offsetX}px, ${dragState.offsetY}px)` : undefined,
                    transition: isDragging ? 'none' : undefined,
                  }}
                  onClick={(e) => {
                    if (dragState || suppressClick.current || savingMove.current) { e.stopPropagation(); return; }
                    e.stopPropagation();
                    onAppointmentClick(app);
                  }}
                  onPointerDown={(e) => handlePointerDownCard(e, app, 'move')}>
                  <div className="flex items-center justify-between gap-1 leading-tight">
                    <span className="font-medium truncate flex-1 min-w-0 text-[10px]">
                      {app.client?.first_name} {app.client?.last_name || ''}
                    </span>
                    <FinancialStatus finance={app.finance} />
                    <span className="text-[9px] text-slate-600 flex-shrink-0">
                      {format(parseISO(app.start_time), 'HH:mm')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-600 text-[9px] leading-tight"><span className="truncate flex-1">{appointmentServiceName(app)}</span>{app.status === 'no_show' && <span className="ml-1 rounded bg-amber-950 px-1 text-[9px] font-semibold text-white shrink-0">Assente</span>}<BookingSource source={app.source} /></div>
                  {app.service?.price_cents != null && cardHeight >= 38 && (
                    <div className="text-[9px] font-medium text-slate-700 leading-tight">€{(app.service.price_cents / 100).toFixed(0)}</div>
                  )}

                  {cardHeight >= 64 && <div className="text-[9px] leading-tight truncate mt-0.5" style={{ color: cfg.text }}>{cfg.label}</div>}
                  {hasBuffer && (
                    <div className="absolute left-0 right-0 bottom-0 h-1.5 bg-gray-300/50 rounded-b-md border-t border-dashed border-gray-400"
                      title="Tempo buffer (pulizia)" />
                  )}

                  {isConflicting && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold">!</div>
                  )}

                  <div
                    className="absolute left-0 right-0 bottom-0 h-2 cursor-s-resize hover:bg-blue-200/50 rounded-b-md"
                    onPointerDown={(e) => handlePointerDownCard(e, app, 'resize')}
                    data-resize-handle="true" title="Trascina per estendere" />
                </div>
              );
            });
          }

          // Off-duty senza appuntamenti → semplice "giorno libero"
          if (isOff && stApps.length === 0) {
            return (
              <div key={stylist.id} data-stylist-id={stylist.id} className="flex-1 border-l border-gray-100 relative" style={{ height: `${totalHeight}px` }}>
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Giorno libero</div>
              </div>
            );
          }

          // Off-duty con appuntamenti manuali → card visibili su sfondo grigio
          if (isOff) {
            return (
              <div key={stylist.id} data-stylist-id={stylist.id} className="flex-1 border-l border-gray-100 relative bg-gray-100/50" style={{ height: `${totalHeight}px` }}>
                <div className="absolute top-1.5 left-0 right-0 text-center z-0 pointer-events-none">
                  <span className="text-[10px] text-gray-400 bg-white/70 px-2 py-0.5 rounded-full">Giorno libero</span>
                </div>
                {renderAppointmentCards()}
              </div>
            );
          }

          // ── Stylist in servizio: colonna normale con griglia, fasce, blocchi ──
          const gaps: { top: number; height: number; label?: string }[] = [];
          const stOpen = timeToMinutes(stShifts[0].open);
          const stClose = timeToMinutes(stShifts[stShifts.length - 1].close);

          // Gap before first shift
          if (stOpen > globalOpen) {
            gaps.push({ top: 0, height: minuteToY(stOpen) });
          }
          // Gaps between shifts
          for (let i = 0; i < stShifts.length - 1; i++) {
            const gapStart = timeToMinutes(stShifts[i].close);
            const gapEnd = timeToMinutes(stShifts[i + 1].open);
            if (gapEnd > gapStart) {
              gaps.push({
                top: minuteToY(gapStart),
                height: minuteToY(gapEnd) - minuteToY(gapStart),
                label: '',
              });
            }
          }
          // Gap after last shift
          if (stClose < globalClose) {
            gaps.push({ top: minuteToY(stClose), height: totalHeight - minuteToY(stClose) });
          }

          /** Check if a minute value falls within any working shift */
          function isInShift(minute: number): boolean {
            return stShifts!.some(s => {
              const so = timeToMinutes(s.open);
              const sc = timeToMinutes(s.close);
              return minute >= so && minute < sc;
            });
          }

          return (
            <div key={stylist.id} data-stylist-id={stylist.id} className="flex-1 border-l border-gray-100 relative bg-white"
              style={{ height: `${totalHeight}px` }}>
              {/* 15-min grid lines */}
              {(() => {
                const lines: React.ReactNode[] = [];
                const startMin = Math.floor(globalOpen / 15) * 15;
                const endMin = Math.ceil(globalClose / 15) * 15;
                for (let m = startMin; m <= endMin; m += 15) {
                  const isHour = m % 60 === 0;
                  lines.push(
                    <div key={`grid-${m}`}
                      className={`absolute left-0 right-0 border-b pointer-events-none ${isHour ? 'border-gray-800' : 'border-gray-200 border-dashed'}`}
                      style={{ top: `${minuteToY(m)}px` }} />
                  );
                }
                return lines;
              })()}

              {/* Off-hours & lunch gaps shading */}
              {gaps.map((gap, gi) => (
                <div key={gi} className="absolute left-0 right-0 bg-gray-100/60 pointer-events-none z-0 flex items-center justify-center"
                  style={{ top: `${gap.top}px`, height: `${Math.max(gap.height, 8)}px` }}>
                  {gap.label && gap.height >= 30 && (
                    <span className="text-[10px] text-gray-400 font-medium">{gap.label}</span>
                  )}
                </div>
              ))}

              {/* Time blocks */}
              {stBlocks.map(b => {
                const bStart = parseISO(b.start_time);
                const bEnd = parseISO(b.end_time);
                const bStartMin = bStart.getHours() * 60 + bStart.getMinutes();
                const bEndMin = bEnd.getHours() * 60 + bEnd.getMinutes();
                const top = minuteToY(Math.max(bStartMin, globalOpen));
                const h = minuteToY(Math.min(bEndMin, globalClose)) - top;
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
              {renderAppointmentCards()}

              {/* Empty slot click area — only within working shifts */}
              <div className="absolute inset-0 z-0"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const minute = Math.floor(yToMinute(y) / 15) * 15;
                  // Ignore clicks outside working shifts (pausa pranzo, etc.)
                  if (!isInShift(minute)) return;
                  const h = Math.floor(minute / 60);
                  const m = minute % 60;
                  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
                  const offsetMin = -date.getTimezoneOffset();
                  const sign = offsetMin >= 0 ? '+' : '-';
                  const absMin = Math.abs(offsetMin);
                  const offH = String(Math.floor(absMin / 60)).padStart(2, '0');
                  const offM = String(absMin % 60).padStart(2, '0');
                  const tz = `${sign}${offH}:${offM}`;
                  onSlotClick(stylist.id, format(date, `yyyy-MM-dd`) + `T${timeStr}${tz}`);
                }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
