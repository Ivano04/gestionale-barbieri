'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarHeader } from './components/CalendarHeader';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { MonthView } from './components/MonthView';
import { AppointmentModal } from './components/AppointmentModal';
import type { Appointment, Service, Client, User } from '@/lib/types';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function CalendarPage() {
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stylists, setStylists] = useState<Pick<User, 'id' | 'full_name'>[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [salonId, setSalonId] = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (!users?.salon_id) return;
      setSalonId(users.salon_id);
    });
  }, []);

  const loadData = useCallback(async () => {
    if (!salonId) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    const [appsRes, svcRes] = await Promise.all([
      fetch(`/api/appointments?salon_id=${salonId}&date=${dateStr}`).then(r => r.json()),
      fetch(`/api/services?salon_id=${salonId}`).then(r => r.json()),
    ]);
    const { data: clientsData } = await supabase.from('clients').select('*').eq('salon_id', salonId).order('last_name');
    const { data: stylistsData } = await supabase.from('users').select('id, full_name').eq('salon_id', salonId);
    setAppointments(Array.isArray(appsRes) ? appsRes : []);
    setServices(Array.isArray(svcRes) ? svcRes : []);
    setClients(clientsData || []);
    setStylists(stylistsData || []);
  }, [salonId, date]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!salonId) return;
    const channel = supabase
      .channel('appointments-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `salon_id=eq.${salonId}` }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [salonId, loadData]);

  function handleNewAppointment() {
    setSelectedAppointment({} as Appointment);
  }

  async function handleSave(form: Partial<Appointment>) {
    const isNew = !form.id;
    const url = isNew ? '/api/appointments' : `/api/appointments/${form.id}`;
    const method = isNew ? 'POST' : 'PATCH';
    const body = { ...form, salon_id: salonId, source: form.source || 'manual' };

    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      setSelectedAppointment(null);
      loadData();
      toast.success(isNew ? 'Appuntamento creato' : 'Appuntamento aggiornato');
    } else {
      const err = await res.json();
      toast.error(err.error || 'Errore');
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
    setSelectedAppointment(null);
    loadData();
    toast.success('Appuntamento cancellato');
  }

  return (
    <div>
      <CalendarHeader date={date} view={view} onDateChange={setDate} onViewChange={setView} onNewAppointment={handleNewAppointment} />
      <div className="mx-4 mt-4">
        {view === 'day' && (
          <DayView
            date={date} stylists={stylists} appointments={appointments}
            onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
            onAppointmentClick={setSelectedAppointment}
          />
        )}
        {view === 'week' && (
          <WeekView
            date={date} stylists={stylists} appointments={appointments}
            onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
            onAppointmentClick={setSelectedAppointment}
          />
        )}
        {view === 'month' && (
          <MonthView
            date={date} appointments={appointments}
            onDayClick={(d) => { setDate(d); setView('day'); }}
          />
        )}
      </div>
      {selectedAppointment && (
        <AppointmentModal
          appointment={selectedAppointment}
          services={services} clients={clients} stylists={stylists}
          onClose={() => setSelectedAppointment(null)}
          onSave={handleSave} onDelete={handleDelete}
        />
      )}
    </div>
  );
}
