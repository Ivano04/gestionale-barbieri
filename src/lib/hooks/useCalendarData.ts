'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Appointment, Service, Client, User, TimeBlock } from '@/lib/types';
import { format, startOfWeek, addDays } from 'date-fns';
import { toast } from 'sonner';
import { normalizeShifts, shiftBounds, type WorkingHoursShift } from '@/lib/working-hours';

export interface CalendarData {
  appointments: Appointment[];
  services: Service[];
  clients: Client[];
  stylists: Pick<User, 'id' | 'full_name' | 'working_hours'>[];
  timeBlocks: TimeBlock[];
  /** Multi-shift salon hours for the selected day */
  salonShifts: WorkingHoursShift[];
  /** Global min/max bounds for timeline drawing */
  salonHours: { open: string; close: string };
  loading: boolean;
  error: string | null;
}

export function useCalendarData(salonId: string, date: Date | null, view: 'day' | 'week' = 'day') {
  const [data, setData] = useState<CalendarData>({
    appointments: [], services: [], clients: [], stylists: [],
    timeBlocks: [], salonShifts: [{ open: '09:00', close: '19:00' }], salonHours: { open: '09:00', close: '19:00' },
    loading: false, error: null,
  });

  const [supabase] = useState(createClient);
  const requestId = useRef(0);
  const invalidateRequests = useCallback(() => { requestId.current++; }, []);

  const loadData = useCallback(async (silent = false) => {
    if (!salonId || !date) return;
    const currentRequest = ++requestId.current;
    if (!silent) setData(prev => ({ ...prev, loading: true, error: null }));

    try {
      const firstDay = view === 'week' ? startOfWeek(date, { weekStartsOn: 1 }) : date;
      const dateStr = format(firstDay, 'yyyy-MM-dd');
      const endDate = format(view === 'week' ? addDays(firstDay, 6) : firstDay, 'yyyy-MM-dd');
      const cacheBuster = Date.now(); // Bypassa la cache del browser e di Next.js

      const [appsRes, svcRes] = await Promise.all([
        fetch(`/api/appointments?salon_id=${salonId}&date=${dateStr}&end_date=${endDate}&_t=${cacheBuster}`).then(r => {
          if (!r.ok) throw new Error(`Appointments: ${r.status}`);
          return r.json();
        }),
        fetch(`/api/services?salon_id=${salonId}&_t=${cacheBuster}`).then(r => {
          if (!r.ok) throw new Error(`Services: ${r.status}`);
          return r.json();
        }),
      ]);

      const [
        { data: clientsData },
        { data: stylistsData },
        { data: salonData },
      ] = await Promise.all([
        supabase.from('clients').select('*').eq('salon_id', salonId).order('last_name'),
        supabase.from('users').select('id, full_name, working_hours, is_active').eq('salon_id', salonId).eq('role', 'stylist').or('is_active.eq.true,is_active.is.null').order('full_name').limit(50),
        supabase.from('salons').select('working_hours, open_time, close_time').eq('id', salonId).single(),
      ]);

      // Fetch time blocks (pass date to include today's blocks even if past)
      let timeBlocks: TimeBlock[] = [];
      try {
        const tbRes = await fetch(`/api/time-blocks?salon_id=${salonId}&date=${dateStr}&end_date=${endDate}&_t=${cacheBuster}`);
        if (tbRes.ok) timeBlocks = await tbRes.json();
      } catch { /* time blocks are non-critical */ }

      // Compute salon shifts for selected date
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const todayName = dayNames[date.getDay()];
      let salonShifts: WorkingHoursShift[] = [{ open: '09:00', close: '19:00' }];
      let salonHours = { open: '09:00', close: '19:00' };
      if (salonData) {
        let wh = salonData.working_hours as Record<string, any> | null;
        if (typeof wh === 'string') try { wh = JSON.parse(wh); } catch {}
        const dayValue = wh?.[todayName];
        if (Object.keys(wh || {}).length > 0 && dayValue === null) {
          // Explicitly closed
          salonShifts = [];
          salonHours = { open: '00:00', close: '00:00' };
        } else {
          const shifts = normalizeShifts(dayValue);
          if (shifts) {
            salonShifts = shifts;
            salonHours = shiftBounds(shifts);
          } else {
            salonShifts = [{ open: salonData.open_time || '09:00', close: salonData.close_time || '19:00' }];
            salonHours = { open: salonShifts[0].open, close: salonShifts[0].close };
          }
        }
      }

      if (currentRequest !== requestId.current) return;
      setData({
        appointments: Array.isArray(appsRes) ? appsRes : [],
        services: Array.isArray(svcRes) ? svcRes : [],
        clients: clientsData || [],
        stylists: stylistsData || [],
        timeBlocks: Array.isArray(timeBlocks) ? timeBlocks : [],
        salonShifts,
        salonHours,
        loading: false,
        error: null,
      });
    } catch (err: any) {
      if (currentRequest !== requestId.current) return;
      const msg = err.message || 'Errore caricamento dati';
      setData(prev => ({ ...prev, loading: false, error: msg }));
      if (!silent) toast.error(msg);
    }
  }, [salonId, date, view, supabase]);

  // Load on mount and when dependencies change
  useEffect(() => { void loadData(); return invalidateRequests; }, [loadData, invalidateRequests]);

  // Realtime where enabled, plus a quiet fallback for asynchronous fiscal jobs.
  useEffect(() => {
    if (!salonId) return;
    let debounce: ReturnType<typeof setTimeout>;
    const refreshSoon = () => { clearTimeout(debounce); debounce = setTimeout(() => { void loadData(true); }, 300); };
    let channel = supabase.channel(`calendar-live-${salonId}`);
    for (const table of ['appointments', 'payments', 'salon_sales', 'fiscal_documents', 'refund_jobs', 'sale_reversals']) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `salon_id=eq.${salonId}` }, refreshSoon);
    }
    channel.subscribe();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void loadData(true); }, 30000);
    return () => { clearTimeout(debounce); clearInterval(timer); void supabase.removeChannel(channel); };
  }, [salonId, supabase, loadData]);

  // Refresh on window focus OR page becoming visible
  // (Next.js Router Cache keeps pages alive in background —
  //  without this, navigating back shows stale data)
  useEffect(() => {
    const onFocus = () => { void loadData(true); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadData(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadData]);

  return { ...data, refresh: loadData };
}
