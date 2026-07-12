'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Appointment, Service, Client, User, TimeBlock } from '@/lib/types';
import { format } from 'date-fns';
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

export function useCalendarData(salonId: string, date: Date | null) {
  const [data, setData] = useState<CalendarData>({
    appointments: [], services: [], clients: [], stylists: [],
    timeBlocks: [], salonShifts: [{ open: '09:00', close: '19:00' }], salonHours: { open: '09:00', close: '19:00' },
    loading: false, error: null,
  });

  const supabase = createClient();

  const loadData = useCallback(async () => {
    if (!salonId || !date) return;
    setData(prev => ({ ...prev, loading: true, error: null }));

    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const cacheBuster = Date.now(); // Bypassa la cache del browser e di Next.js

      const [appsRes, svcRes] = await Promise.all([
        fetch(`/api/appointments?salon_id=${salonId}&date=${dateStr}&_t=${cacheBuster}`).then(r => {
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
        const tbRes = await fetch(`/api/time-blocks?salon_id=${salonId}&date=${dateStr}&_t=${cacheBuster}`);
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
      const msg = err.message || 'Errore caricamento dati';
      setData(prev => ({ ...prev, loading: false, error: msg }));
      toast.error(msg);
    }
  }, [salonId, date, supabase]);

  // Load on mount and when dependencies change
  useEffect(() => { loadData(); }, [loadData]);

  // Supabase Realtime: aggiornamento live quando il DB cambia
  useEffect(() => {
    if (!salonId) return;
    const channel = supabase
      .channel('calendar-live')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'appointments' },
        (payload) => { console.log('[realtime] event:', payload.eventType); loadData(); }
      )
      .subscribe((status) => { console.log('[realtime] sub status:', status); });
    return () => { supabase.removeChannel(channel); };
  }, [salonId, supabase]);

  // Refresh on window focus OR page becoming visible
  // (Next.js Router Cache keeps pages alive in background —
  //  without this, navigating back shows stale data)
  useEffect(() => {
    const onFocus = () => loadData();
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadData();
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
