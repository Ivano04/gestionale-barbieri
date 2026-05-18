'use client';
import { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { Appointment, Service, Client, User } from '@/lib/types';
import { format, parseISO } from 'date-fns';

interface Props {
  appointment: Appointment | null;
  services: Service[];
  clients: Client[];
  stylists: Pick<User, 'id' | 'full_name'>[];
  onClose: () => void;
  onSave: (data: Partial<Appointment>) => void;
  onDelete: (id: string) => void;
}

export function AppointmentModal({ appointment, services, clients, stylists, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<Partial<Appointment>>({});
  const isNew = !appointment?.id;

  useEffect(() => {
    setForm(appointment || {});
  }, [appointment]);

  if (!appointment) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{isNew ? 'Nuovo Appuntamento' : 'Modifica Appuntamento'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-sm text-gray-500">Cliente</label>
            <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.client_id || ''} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
              <option value="">Seleziona cliente...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.phone ? `· ${c.phone}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-500">Servizio</label>
            <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.service_id || ''} onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}>
              <option value="">Seleziona servizio...</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes}min · €{(s.price_cents/100).toFixed(2)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-500">Operatore</label>
            <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.stylist_id || ''} onChange={e => setForm(f => ({ ...f, stylist_id: e.target.value }))}>
              <option value="">Seleziona operatore...</option>
              {stylists.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-500">Data e ora inizio</label>
            <input type="datetime-local"
              className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
              value={form.start_time ? format(parseISO(form.start_time), "yyyy-MM-dd'T'HH:mm") : ''}
              onChange={e => setForm(f => ({ ...f, start_time: new Date(e.target.value).toISOString() }))}
            />
          </div>
          <div>
            <label className="text-sm text-gray-500">Note</label>
            <textarea className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" rows={2}
              value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2 justify-end pt-2">
            {!isNew && (
              <button onClick={() => onDelete(appointment.id)} className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1 text-sm">
                <Trash2 size={16} /> Elimina
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Annulla</button>
            <button onClick={() => onSave(form)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">Salva</button>
          </div>
        </div>
      </div>
    </div>
  );
}
