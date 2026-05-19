'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarHeader } from './components/CalendarHeader';
import { DayView } from './components/DayView';
import { WeekView } from './components/WeekView';
import { AppointmentModal } from './components/AppointmentModal';
import type { Appointment } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { todayDateStr, buildSlotTime } from '@/lib/date-utils';
import { useCalendarData } from '@/lib/hooks/useCalendarData';

export default function CalendarPage() {
  const [date, setDate] = useState<Date | null>(null);
  // Hydration-safe: initialize date on client only
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

  const { appointments, services, clients, stylists, timeBlocks, salonHours, loading, refresh } = useCalendarData(salonId, date);

  if (!date) return <div className="p-8 text-center text-gray-400">Caricamento calendario...</div>;

  // Time block handler
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
    // Block past bookings
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

      if (res.ok) {
        toast.success(isNew ? 'Appuntamento creato' : 'Appuntamento aggiornato');
        setSelectedAppointment(null);
        refresh();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Errore salvataggio');
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

  return (
    <div>
      {loading && <div className="h-1 bg-blue-100 w-full overflow-hidden"><div className="h-full bg-blue-500 animate-pulse" style={{ width: '60%' }} /></div>}
      <CalendarHeader date={date} view={view} onDateChange={setDate} onViewChange={setView} onNewAppointment={handleNewAppointment} onNewBlock={() => setShowBlockModal(true)} />
      <div className="mx-0 md:mx-4 mt-0 md:mt-4">
        {view === 'day' && (
          <DayView
            date={date} stylists={stylists} appointments={appointments} timeBlocks={timeBlocks} salonHours={salonHours}
            onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
            onAppointmentClick={setSelectedAppointment}
            onDeleteBlock={handleDeleteBlock}
          />
        )}
        {view === 'week' && (
          <WeekView
            date={date} stylists={stylists} appointments={appointments} timeBlocks={timeBlocks}
            onSlotClick={(stylist_id, start_time) => setSelectedAppointment({ stylist_id, start_time } as Appointment)}
            onAppointmentClick={setSelectedAppointment}
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
        />
      )}

      {/* Time block modal */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBlockModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Blocca / Sblocca fasce</h3>

            {/* Existing blocks */}
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
                        await fetch(`/api/time-blocks?id=${b.id}`, { method: 'DELETE' });
                        refresh();
                      }} className="text-red-500 hover:bg-red-100 p-1 rounded">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* New block form */}
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
