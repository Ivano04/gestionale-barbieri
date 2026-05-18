'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarHeader } from './components/CalendarHeader';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { AppointmentModal } from './components/AppointmentModal';
import type { Appointment, Service, Client, User, TimeBlock } from '@/lib/types';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function CalendarPage() {
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState<'day' | 'week'>('day');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stylists, setStylists] = useState<Pick<User, 'id' | 'full_name'>[]>([]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockForm, setBlockForm] = useState({ stylist_id: '', date: format(new Date(), 'yyyy-MM-dd'), start: '12:00', end: '13:00', reason: '' });
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

  // Time block handler
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
      <CalendarHeader date={date} view={view} onDateChange={setDate} onViewChange={setView} onNewAppointment={handleNewAppointment} onNewBlock={() => setShowBlockModal(true)} />
      <div className="mx-4 mt-4">
        {view === 'day' && (
          <DayView
            date={date} stylists={stylists} appointments={appointments} timeBlocks={timeBlocks}
            onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
            onAppointmentClick={setSelectedAppointment}
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
      </div>
      {selectedAppointment && (
        <AppointmentModal
          appointment={selectedAppointment}
          services={services} clients={clients} stylists={stylists}
          onClose={() => setSelectedAppointment(null)}
          onSave={handleSave} onDelete={handleDelete}
        />
      )}

      {/* Time block modal */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBlockModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Blocca fascia oraria</h3>
            <div className="space-y-3">
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={blockForm.stylist_id}
                onChange={e => setBlockForm({ ...blockForm, stylist_id: e.target.value })}>
                <option value="">Tutto il salone</option>
                {stylists.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={blockForm.date}
                onChange={e => setBlockForm({ ...blockForm, date: e.target.value })} />
              <div className="flex gap-2">
                <input type="time" className="flex-1 border rounded-lg px-3 py-2 text-sm" value={blockForm.start}
                  onChange={e => setBlockForm({ ...blockForm, start: e.target.value })} />
                <span className="text-gray-400 self-center">–</span>
                <input type="time" className="flex-1 border rounded-lg px-3 py-2 text-sm" value={blockForm.end}
                  onChange={e => setBlockForm({ ...blockForm, end: e.target.value })} />
              </div>
              <input type="text" placeholder="Motivo (es. Pausa pranzo)" className="w-full border rounded-lg px-3 py-2 text-sm" value={blockForm.reason}
                onChange={e => setBlockForm({ ...blockForm, reason: e.target.value })} />
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setShowBlockModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Annulla</button>
                <button onClick={async () => {
                  const startTime = `${blockForm.date}T${blockForm.start}:00+02:00`;
                  const endTime = `${blockForm.date}T${blockForm.end}:00+02:00`;
                  const res = await fetch('/api/time-blocks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      salon_id: salonId,
                      stylist_id: blockForm.stylist_id || null,
                      start_time: startTime,
                      end_time: endTime,
                      reason: blockForm.reason
                    }),
                  });
                  if (res.ok) {
                    const block = await res.json();
                    setTimeBlocks(prev => [...prev, block]);
                    setShowBlockModal(false);
                    toast.success('Fascia bloccata');
                  }
                }} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium">
                  Blocca
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
