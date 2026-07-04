'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarHeader } from './components/CalendarHeader';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { AppointmentModal } from './components/AppointmentModal';
import type { Appointment } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { todayDateStr, buildSlotTime } from '@/lib/date-utils';
import { useCalendarData } from '@/lib/hooks/useCalendarData';

export default function CalendarPage() {
  const [date, setDate] = useState<Date | null>(null);
  useEffect(() => { if (!date) setDate(new Date()); }, []);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockForm, setBlockForm] = useState({ stylist_id: '', date: todayDateStr(), start: '12:00', end: '13:00', reason: '' });
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

  const { appointments, services, clients, stylists, timeBlocks, salonShifts, salonHours, loading, refresh } = useCalendarData(salonId, date);

  if (!date) return <div className="p-8 text-center text-gray-400">Caricamento calendario...</div>;

  async function handleDeleteBlock(blockId: string) {
    try {
      const res = await fetch(`/api/time-blocks?id=${blockId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Blocco rimosso');
        refresh();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Errore rimozione blocco');
      }
    } catch {
      toast.error('Errore di connessione');
    }
  }

  function handleNewAppointment() {
    setSelectedAppointment({} as Appointment);
  }

  async function handleSave(form: Record<string, any>) {
    if (form.start_time && new Date(form.start_time) < new Date()) {
      toast.error('Non puoi prenotare nel passato');
      return;
    }

    const isNew = !form.id;
    const body = { ...form, salon_id: salonId, source: form.source || 'manual' };

    const url = isNew ? '/api/appointments' : `/api/appointments/${form.id}`;
    const method = isNew ? 'POST' : 'PATCH';
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();

      if (res.ok) {
        toast.success(isNew ? 'Appuntamento creato' : 'Appuntamento aggiornato');
        if (data.warnings?.length) {
          data.warnings.forEach((w: any) => toast.warning(w.message || 'Attenzione: possibile sovrapposizione'));
        }
        setSelectedAppointment(null);
        refresh();
      } else {
        toast.error(data.error || 'Errore salvataggio');
        // If soft conflict came back but was rejected for another reason
        if (data.conflict) {
          toast.warning(`Conflitto rilevato: ${data.conflict.overlapPhase || 'sconosciuto'}`);
        }
      }
    } catch {
      toast.error('Errore di connessione');
    }
  }

  async function handleDelete(id: string) {
    setSelectedAppointment(null);
    try {
      const res = await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Appuntamento cancellato');
      } else {
        const err = await res.json();
        toast.error(err.error || 'Errore cancellazione');
      }
    } catch {
      toast.error('Errore di connessione');
    }
    refresh();
  }

  async function handleAppointmentMove(appointmentId: string, newStylistId: string, newStartTime: string, newEndTime?: string) {
    const body: Record<string, any> = { stylist_id: newStylistId, start_time: newStartTime };
    if (newEndTime) body.end_time = newEndTime;
    const res = await fetch(`/api/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      refresh();
      return { warnings: data.warnings };
    }
    return { error: data.error, warnings: data.warnings };
  }

  async function handleAppointmentResize(appointmentId: string, newEndTime: string) {
    const res = await fetch(`/api/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ end_time: newEndTime }),
    });
    const data = await res.json();
    if (res.ok) {
      refresh();
      return { warnings: data.warnings };
    }
    return { error: data.error, warnings: data.warnings };
  }

  async function handleAddService(appointmentId: string, serviceId: string) {
    const res = await fetch(`/api/appointments/${appointmentId}/add-service`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Errore');
    refresh();
    return data;
  }

  async function handleSwapRequest(appointmentId: string, targetStylistId: string) {
    // Move the conflicting appointment to another stylist
    const app = appointments.find(a => a.id === appointmentId);
    if (!app) return;
    const res = await fetch(`/api/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stylist_id: targetStylistId }),
    });
    if (res.ok) {
      toast.success(`Appuntamento spostato su ${stylists.find(s => s.id === targetStylistId)?.full_name}`);
      refresh();
    } else {
      const err = await res.json();
      toast.error(err.error || 'Spostamento fallito');
    }
  }

  return (
    <div>
      {loading && <div className="h-1 bg-blue-100 w-full overflow-hidden"><div className="h-full bg-blue-500 animate-pulse" style={{ width: '60%' }} /></div>}
      <CalendarHeader date={date} view={view} onDateChange={setDate} onViewChange={setView} onNewAppointment={handleNewAppointment} onNewBlock={() => setShowBlockModal(true)} />
      <div className="mx-0 md:mx-4 mt-0 md:mt-4">
        {view === 'day' && (
          <DayView
            date={date} stylists={stylists} appointments={appointments} timeBlocks={timeBlocks} salonShifts={salonShifts} salonHours={salonHours}
            onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
            onAppointmentClick={setSelectedAppointment}
            onAppointmentMove={handleAppointmentMove}
            onAppointmentResize={handleAppointmentResize}
            onDeleteBlock={handleDeleteBlock}
            onSwapRequest={handleSwapRequest}
          />
        )}
        {view === 'week' && (
          <WeekView
            date={date} stylists={stylists} appointments={appointments} timeBlocks={timeBlocks}
            onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
            onAppointmentClick={setSelectedAppointment}
            onAppointmentMove={handleAppointmentMove}
            onDeleteBlock={handleDeleteBlock}
          />
        )}
      </div>
      {selectedAppointment && (
        <AppointmentModal
          appointment={selectedAppointment}
          services={services} clients={clients} stylists={stylists} salonId={salonId}
          onClose={() => setSelectedAppointment(null)}
          onSave={handleSave} onDelete={handleDelete}
          onAddService={handleAddService}
        />
      )}

      {/* Time block modal — unchanged */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBlockModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Blocca / Sblocca fasce</h3>

            {timeBlocks.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-500 mb-2">Fasce attive</h4>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {timeBlocks.map(b => (
                    <div key={b.id} className="flex items-center justify-between p-2 bg-red-50 rounded-lg text-xs">
                      <div>
                        <span className="font-medium">{b.stylist_id ? stylists.find(s => s.id === b.stylist_id)?.full_name : 'Tutto il salone'}</span>
                        <span className="text-gray-500 ml-2">
                          {format(parseISO(b.start_time), 'dd/MM HH:mm')} – {format(parseISO(b.end_time), 'HH:mm')}
                        </span>
                        {b.reason && <span className="text-gray-400 ml-1">· {b.reason}</span>}
                      </div>
                      <button onClick={async () => {
                        try {
                          const res = await fetch(`/api/time-blocks?id=${b.id}`, { method: 'DELETE' });
                          if (res.ok) { toast.success('Blocco rimosso'); refresh(); }
                          else { const err = await res.json(); toast.error(err.error || 'Errore'); }
                        } catch { toast.error('Errore di connessione'); }
                      }} className="text-red-500 hover:bg-red-100 p-1 rounded">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-500 mb-3">Nuova fascia</h4>
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
                <input type="text" placeholder="Motivo" className="w-full border rounded-lg px-3 py-2 text-sm" value={blockForm.reason}
                  onChange={e => setBlockForm({ ...blockForm, reason: e.target.value })} />
                <div className="flex gap-2 justify-end pt-2">
                  <button onClick={() => setShowBlockModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Chiudi</button>
                  <button onClick={async () => {
                    const startTime = buildSlotTime(blockForm.date, blockForm.start);
                    const endTime = buildSlotTime(blockForm.date, blockForm.end);
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
                      setBlockForm({ stylist_id: '', date: todayDateStr(), start: '12:00', end: '13:00', reason: '' });
                      refresh();
                    } else {
                      toast.error('Errore creazione blocco');
                    }
                  }} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium">
                    Blocca
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
