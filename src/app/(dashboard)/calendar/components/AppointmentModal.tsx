'use client';
import { useState, useEffect } from 'react';
import { X, Trash2, Loader2 } from 'lucide-react';
import type { Appointment, Service, Client, User } from '@/lib/types';
import { format, parseISO, addDays } from 'date-fns';
import { it } from 'date-fns/locale';
import { formatPhone, countryCodes } from '@/lib/utils';
import { buildSlotTime } from '@/lib/date-utils';

interface Props {
  appointment: Appointment | null;
  services: Service[];
  clients: Client[];
  stylists: Pick<User, 'id' | 'full_name'>[];
  salonId: string;
  onClose: () => void;
  onSave: (data: Record<string, any>) => void;
  onDelete: (id: string) => void;
}

export function AppointmentModal({ appointment, services, clients, stylists, salonId, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<Partial<Appointment>>({});
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [newClient, setNewClient] = useState({ first_name: '', last_name: '', phone: '' });
  const [clientPrefix, setClientPrefix] = useState('+39');
  const [slots, setSlots] = useState<{ time: string; stylist_id: string; stylist_name: string }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotDate, setSlotDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const isNew = !appointment?.id;

  useEffect(() => {
    setForm(appointment || {});
    if (appointment?.client_id) setClientMode('existing');
    if (appointment?.start_time) setSlotDate(format(parseISO(appointment.start_time), 'yyyy-MM-dd'));
  }, [appointment]);

  // Fetch available slots when service, stylist, or date changes
  useEffect(() => {
    if (!salonId || !form.service_id || !form.stylist_id || !slotDate) return;
    setSlotsLoading(true);
    fetch(`/api/slots?salon_id=${salonId}&service_id=${form.service_id}&stylist_id=${form.stylist_id}&date=${slotDate}`)
      .then(r => r.json())
      .then(d => { setSlots(Array.isArray(d) ? d : []); setSlotsLoading(false); });
  }, [salonId, form.service_id, form.stylist_id, slotDate]);

  if (!appointment) return null;

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError('');
    if (!form.service_id) { setError('Seleziona un servizio'); return; }
    if (!form.stylist_id) { setError('Seleziona un operatore'); return; }
    if (!form.start_time) { setError('Seleziona un orario'); return; }
    if (clientMode === 'new') {
      if (!newClient.first_name || !newClient.last_name) { setError('Inserisci nome e cognome del cliente'); return; }
    }
    setSaving(true);
    try {
      const data = clientMode === 'new'
        ? { ...form, client_id: undefined, client: { ...newClient, phone: formatPhone(clientPrefix + newClient.phone) } }
        : form;
      await onSave(data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{isNew ? 'Nuovo Appuntamento' : 'Modifica Appuntamento'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">

          {/* Cliente */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-500">Cliente</label>
              <div className="flex bg-gray-100 rounded-lg p-0.5">
                <button onClick={() => setClientMode('existing')} className={`px-2 py-1 rounded-md text-xs ${clientMode === 'existing' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}>Esistente</button>
                <button onClick={() => setClientMode('new')} className={`px-2 py-1 rounded-md text-xs ${clientMode === 'new' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}>Nuovo</button>
              </div>
            </div>
            {clientMode === 'existing' ? (
              <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.client_id || ''} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                <option value="">Seleziona cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.phone ? `· ${c.phone}` : ''}</option>)}
              </select>
            ) : (
              <div className="space-y-2 mt-1">
                <div className="flex gap-2">
                  <input type="text" placeholder="Nome *" value={newClient.first_name} onChange={e => setNewClient({ ...newClient, first_name: e.target.value })} className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                  <input type="text" placeholder="Cognome *" value={newClient.last_name} onChange={e => setNewClient({ ...newClient, last_name: e.target.value })} className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div className="flex gap-2">
                  <select value={clientPrefix} onChange={e => setClientPrefix(e.target.value)} className="px-2 py-2 border rounded-lg text-sm bg-gray-50 w-24">
                    {countryCodes.slice(0, 8).map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                  </select>
                  <input type="tel" placeholder="Telefono" value={newClient.phone} onChange={e => setNewClient({ ...newClient, phone: e.target.value.replace(/[^\d\s\-\(\)]/g, '') })} className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
            )}
          </div>

          {/* Servizio */}
          <div>
            <label className="text-sm text-gray-500">Servizio</label>
            <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.service_id || ''} onChange={e => setForm(f => ({ ...f, service_id: e.target.value, start_time: '' }))}>
              <option value="">Seleziona servizio...</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes}min · €{(s.price_cents/100).toFixed(2)}</option>)}
            </select>
          </div>

          {/* Operatore */}
          <div>
            <label className="text-sm text-gray-500">Operatore</label>
            <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.stylist_id || ''} onChange={e => setForm(f => ({ ...f, stylist_id: e.target.value, start_time: '' }))}>
              <option value="">Seleziona operatore...</option>
              {stylists.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>

          {/* Slot picker */}
          <div>
            <label className="text-sm text-gray-500">Data e orario</label>
            <div className="flex gap-1 overflow-x-auto mt-1 mb-2">
              {Array.from({ length: 7 }, (_, i) => addDays(new Date(), i)).map(d => {
                const ds = format(d, 'yyyy-MM-dd');
                return (
                  <button key={ds} type="button" onClick={() => { setSlotDate(ds); setForm(f => ({ ...f, start_time: '' })); }}
                    className={`flex-shrink-0 w-12 py-1.5 rounded-lg text-center text-xs transition-colors ${
                      ds === slotDate ? 'bg-blue-600 text-white font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    <div>{format(d, 'EEE', { locale: it })}</div>
                    <div className="font-semibold">{format(d, 'd')}</div>
                  </button>
                );
              })}
            </div>

            {!form.service_id || !form.stylist_id ? (
              <p className="text-xs text-gray-400 text-center py-2">Seleziona servizio e operatore</p>
            ) : slotsLoading ? (
              <div className="flex items-center justify-center py-3"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
            ) : slots.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">Nessuno slot disponibile per questa data</p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto">
                {slots.map((s, i) => {
                  const isSelected = form.start_time ? form.start_time.startsWith(`${slotDate}T${s.time}:00`) : false;
                  return (
                    <button key={i} type="button"
                      onClick={() => setForm(f => ({ ...f, start_time: buildSlotTime(slotDate, s.time) }))}
                      className={`py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-green-50 border border-green-200 text-green-800 hover:bg-green-100'
                      }`}>
                      {s.time}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Canale */}
          <div>
            <label className="text-sm text-gray-500">Canale</label>
            <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" value={form.source || 'manual'} onChange={e => setForm(f => ({ ...f, source: e.target.value as any }))}>
              <option value="walk_in">🚶 Walk-in</option>
              <option value="phone">📞 Telefono</option>
              <option value="whatsapp">💬 WhatsApp</option>
              <option value="widget">📱 Sito/Widget</option>
              <option value="manual">✍️ Manuale</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-500">Note</label>
            <textarea className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" rows={2} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {error && <div className="text-red-600 text-sm bg-red-50 p-2 rounded-lg">{error}</div>}
          <div className="flex items-center gap-2 justify-end pt-2">
            {!isNew && (
              <button onClick={() => { if (confirm('Sicuro di voler cancellare questo appuntamento?')) onDelete(appointment.id); }} className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1 text-sm">
                <Trash2 size={16} /> Elimina
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Annulla</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
              {saving ? 'Salvataggio...' : 'Salva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
