'use client';
import { useState, useEffect } from 'react';
import { X, Trash2, Loader2, ChevronDown } from 'lucide-react';
import type { Appointment, Service, Client, User } from '@/lib/types';
import { format, parseISO, addDays } from 'date-fns';
import { it } from 'date-fns/locale';
import { formatPhone, countryCodes } from '@/lib/utils';
import { todayDateStr, buildSlotTime } from '@/lib/date-utils';

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
  const [slotDate, setSlotDate] = useState(todayDateStr());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isNew = !appointment?.id;

  useEffect(() => {
    setForm(appointment || {});
    if (appointment?.client_id) setClientMode('existing');
    if (appointment?.start_time) setSlotDate(format(parseISO(appointment.start_time), 'yyyy-MM-dd'));
  }, [appointment]);

  useEffect(() => {
    if (!salonId || !form.service_id || !form.stylist_id || !slotDate) return;
    setSlotsLoading(true);
    fetch(`/api/slots?salon_id=${salonId}&service_id=${form.service_id}&stylist_id=${form.stylist_id}&date=${slotDate}`)
      .then(r => r.json())
      .then(d => { setSlots(Array.isArray(d) ? d : []); setSlotsLoading(false); });
  }, [salonId, form.service_id, form.stylist_id, slotDate]);

  if (!appointment) return null;

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  async function handleSave() {
    const errs: Record<string, string> = {};
    if (!form.service_id) errs.service = 'Seleziona un servizio';
    if (!form.stylist_id) errs.stylist = 'Seleziona un operatore';
    if (!form.start_time) errs.time = 'Seleziona un orario';
    if (clientMode === 'new') {
      if (!newClient.first_name) errs.clientFirst = 'Nome richiesto';
      if (!newClient.last_name) errs.clientLast = 'Cognome richiesto';
    }
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSaving(true);
    try {
      const data = clientMode === 'new'
        ? { ...form, client_id: undefined, client: { ...newClient, phone: formatPhone(clientPrefix + newClient.phone.replace(/\s/g, '')) } }
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

        <div className="space-y-4 max-h-[80vh] overflow-y-auto">

          {/* 1. Servizio */}
          <div>
            <label className="text-sm font-medium text-gray-700">Servizio</label>
            <select className={`w-full border rounded-lg px-3 py-2 mt-1 text-sm ${errors.service ? 'border-red-400' : ''}`}
              value={form.service_id || ''}
              onChange={e => { setForm(f => ({ ...f, service_id: e.target.value, start_time: '' })); clearError('service'); }}>
              <option value="">Seleziona servizio...</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes}min · €{(s.price_cents/100).toFixed(2)}</option>)}
            </select>
            {errors.service && <p className="text-red-500 text-xs mt-1">{errors.service}</p>}
          </div>

          {/* 2. Operatore */}
          <div>
            <label className="text-sm font-medium text-gray-700">Operatore</label>
            <select className={`w-full border rounded-lg px-3 py-2 mt-1 text-sm ${errors.stylist ? 'border-red-400' : ''}`}
              value={form.stylist_id || ''}
              onChange={e => { setForm(f => ({ ...f, stylist_id: e.target.value, start_time: '' })); clearError('stylist'); }}>
              <option value="">Seleziona operatore...</option>
              {stylists.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            {errors.stylist && <p className="text-red-500 text-xs mt-1">{errors.stylist}</p>}
          </div>

          {/* 3. Data e Orario */}
          <div>
            <label className="text-sm font-medium text-gray-700">Data e orario</label>
            {errors.time && <p className="text-red-500 text-xs mt-1">{errors.time}</p>}

            {/* Date picker — 7 days, 2-row layout */}
            <div className="flex gap-1.5 overflow-x-auto mt-1.5 mb-2">
              {Array.from({ length: 7 }, (_, i) => addDays(new Date(), i)).map(d => {
                const ds = format(d, 'yyyy-MM-dd');
                return (
                  <button key={ds} type="button"
                    onClick={() => { setSlotDate(ds); setForm(f => ({ ...f, start_time: '' })); clearError('time'); }}
                    className={`flex-shrink-0 w-14 py-2 rounded-xl text-center transition-colors ${
                      ds === slotDate ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    <div className="text-[10px] leading-tight">{format(d, 'EEE', { locale: it })}</div>
                    <div className="font-bold text-base leading-tight">{format(d, 'd')}</div>
                  </button>
                );
              })}
            </div>

            {/* Slot grid — 3 columns */}
            {!form.service_id || !form.stylist_id ? (
              <p className="text-xs text-gray-400 text-center py-2">Seleziona servizio e operatore</p>
            ) : slotsLoading ? (
              <div className="flex items-center justify-center py-3"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
            ) : slots.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">Nessuno slot disponibile</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto">
                {slots.map((s, i) => {
                  const isSelected = form.start_time
                    ? form.start_time.startsWith(`${slotDate}T${s.time}:00`)
                    : false;
                  return (
                    <button key={i} type="button"
                      onClick={() => { setForm(f => ({ ...f, start_time: buildSlotTime(slotDate, s.time) })); clearError('time'); }}
                      className={`py-2.5 px-1 rounded-lg text-xs font-semibold transition-all ${
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

          {/* 4. Cliente */}
          <div>
            <label className="text-sm font-medium text-gray-700">Cliente</label>
            <div className="flex bg-gray-100 rounded-lg p-0.5 mt-1.5 mb-2">
              <button onClick={() => setClientMode('existing')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${clientMode === 'existing' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                Cliente esistente
              </button>
              <button onClick={() => setClientMode('new')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${clientMode === 'new' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                Nuovo cliente
              </button>
            </div>

            {clientMode === 'existing' ? (
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.client_id || ''}
                onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                <option value="">Seleziona cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
              </select>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input type="text" placeholder="Nome *" value={newClient.first_name}
                      onChange={e => { setNewClient({ ...newClient, first_name: e.target.value }); clearError('clientFirst'); }}
                      className={`w-full px-3 py-2 border rounded-lg text-sm ${errors.clientFirst ? 'border-red-400' : ''}`} />
                    {errors.clientFirst && <p className="text-red-500 text-xs mt-0.5">{errors.clientFirst}</p>}
                  </div>
                  <div className="flex-1">
                    <input type="text" placeholder="Cognome *" value={newClient.last_name}
                      onChange={e => { setNewClient({ ...newClient, last_name: e.target.value }); clearError('clientLast'); }}
                      className={`w-full px-3 py-2 border rounded-lg text-sm ${errors.clientLast ? 'border-red-400' : ''}`} />
                    {errors.clientLast && <p className="text-red-500 text-xs mt-0.5">{errors.clientLast}</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <select value={clientPrefix} onChange={e => setClientPrefix(e.target.value)}
                    className="px-2 py-2 border rounded-lg text-sm bg-gray-50 w-24">
                    {countryCodes.slice(0, 8).map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                  </select>
                  <input type="tel" placeholder="Telefono" value={newClient.phone}
                    onChange={e => setNewClient({ ...newClient, phone: e.target.value.replace(/[^\d\s\-\(\)]/g, '') })}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
            )}
          </div>

          {/* 5. Collapsible: Canale + Note */}
          <div>
            <button type="button" onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <ChevronDown size={14} className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              Dettagli aggiuntivi
            </button>
            {advancedOpen && (
              <div className="space-y-3 mt-2 pl-1">
                <div>
                  <label className="text-sm text-gray-500">Canale</label>
                  <select className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
                    value={form.source || 'manual'}
                    onChange={e => setForm(f => ({ ...f, source: e.target.value as any }))}>
                    <option value="walk_in">🚶 Walk-in</option>
                    <option value="phone">📞 Telefono</option>
                    <option value="whatsapp">💬 WhatsApp</option>
                    <option value="widget">📱 Sito/Widget</option>
                    <option value="manual">✍️ Manuale</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Note</label>
                  <textarea className="w-full border rounded-lg px-3 py-2 mt-1 text-sm" rows={2}
                    value={form.notes || ''}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end pt-2 border-t">
            {!isNew && (
              <button
                onClick={() => { if (confirm('Sicuro di voler cancellare questo appuntamento?')) onDelete(appointment.id); }}
                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1 text-sm">
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
