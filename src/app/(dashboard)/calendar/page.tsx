'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarHeader } from './components/CalendarHeader';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { MonthView } from './components/MonthView';
import { AppointmentModal } from './components/AppointmentModal';
import type { Appointment, Service, Client, User, TimeBlock } from '@/lib/types';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function CalendarPage() {
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stylists, setStylists] = useState<Pick<User, 'id' | 'full_name'>[]>([]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
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
    const { data: stylistsData } = await supabase.from('users').select('id, full_name').eq('salon_id', salonId).eq('role', 'stylist');
    setAppointments(Array.isArray(appsRes) ? appsRes : []);
    setServices(Array.isArray(svcRes) ? svcRes : []);
    setClients(clientsData || []);
    setStylists(stylistsData || []);
    // Fetch time blocks
    fetch(`/api/time-blocks?salon_id=${salonId}`).then(r => r.json()).then(d => {
      if (Array.isArray(d)) setTimeBlocks(d);
    });
  }, [salonId, date]);

  useEffect(() => { loadData(); }, [loadData]);

  // Drag & drop handler
  async function handleAppointmentDrop(appointmentId: string, newStylistId: string, newStartTime: string) {
    setAppointments(prev => prev.map(a =>
      a.id === appointmentId ? { ...a, stylist_id: newStylistId, start_time: newStartTime, stylist: stylists.find(s => s.id === newStylistId) as any } : a
    ));
    await fetch(`/api/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stylist_id: newStylistId, start_time: newStartTime }),
    });
    loadData(); // refresh to get correct end_time etc
  }

  // Time block handler
  async function handleBlockSlot(stylistId: string, startTime: string, endTime: string) {
    const res = await fetch('/api/time-blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salon_id: salonId, stylist_id: stylistId || null, start_time: startTime, end_time: endTime }),
    });
    if (res.ok) {
      const block = await res.json();
      setTimeBlocks(prev => [...prev, block]);
    }
  }

  async function handleDeleteBlock(blockId: string) {
    setTimeBlocks(prev => prev.filter(b => b.id !== blockId));
    await fetch(`/api/time-blocks?id=${blockId}`, { method: 'DELETE' });
  }

  function handleNewAppointment() {
    setSelectedAppointment({} as Appointment);
  }

  async function handleSave(form: Record<string, any>) {
    const isNew = !form.id;
    const body = { ...form, salon_id: salonId, source: form.source || 'manual' };

    // Close modal instantly
    setSelectedAppointment(null);

    // Optimistic: add to state immediately with temp ID
    const tempId = 'temp_' + Date.now();
    const optimistic: Appointment = {
      id: tempId,
      salon_id: salonId,
      client_id: form.client_id || null,
      stylist_id: form.stylist_id,
      service_id: form.service_id,
      start_time: form.start_time,
      end_time: '', // will be fixed on reload
      status: 'confirmed',
      source: body.source,
      notes: form.notes || null,
      treatwell_appointment_id: null,
      ghl_appointment_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Attach partial relations for display
      client: form.client ? { id: '', salon_id: salonId, first_name: form.client.first_name, last_name: form.client.last_name, phone: form.client.phone || '', email: null, notes: null, ghl_contact_id: null, treatwell_client_id: null, created_at: '' } : undefined,
      service: services.find(s => s.id === form.service_id),
      stylist: stylists.find(s => s.id === form.stylist_id) as any,
    };

    if (isNew) setAppointments(prev => [...prev, optimistic]);

    // Save in background
    const url = isNew ? '/api/appointments' : `/api/appointments/${form.id}`;
    const method = isNew ? 'POST' : 'PATCH';
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        const saved = await res.json();
        if (isNew) {
          // Replace temp with real
          setAppointments(prev => prev.map(a => a.id === tempId ? saved : a));
        } else {
          // For edits: full reload to get joined relations
          loadData();
        }
        toast.success(isNew ? 'Creato' : 'Aggiornato');
      } else {
        setAppointments(prev => prev.filter(a => a.id !== tempId));
        const err = await res.json();
        toast.error(err.error || 'Errore');
        if (isNew) setSelectedAppointment(form as any);
      }
    } catch {
      setAppointments(prev => prev.filter(a => a.id !== tempId));
      toast.error('Errore di connessione');
    }
  }

  function handleDelete(id: string) {
    setSelectedAppointment(null);
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: 'cancelled' } : a));
    fetch(`/api/appointments/${id}`, { method: 'DELETE' }).catch(() => {
      loadData(); // reload on failure
      toast.error('Errore cancellazione');
    });
  }

  return (
    <div>
      <CalendarHeader date={date} view={view} onDateChange={setDate} onViewChange={setView} onNewAppointment={handleNewAppointment} />
      <div className="mx-4 mt-4">
        {view === 'day' && (
          <DayView
            date={date} stylists={stylists} appointments={appointments} timeBlocks={timeBlocks}
            onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
            onAppointmentClick={setSelectedAppointment}
            onAppointmentDrop={handleAppointmentDrop}
            onBlockSlot={handleBlockSlot}
            onDeleteBlock={handleDeleteBlock}
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
