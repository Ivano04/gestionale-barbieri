'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Service } from '@/lib/types';
import { Users, Clock, Plus, Loader2, Scissors, ChevronDown, Minus } from 'lucide-react';
import { normalizeShifts, type WorkingHoursShift } from '@/lib/working-hours';
import { toast } from 'sonner';

const DAYS = [
  { key: 'mon', label: 'Lun' },
  { key: 'tue', label: 'Mar' },
  { key: 'wed', label: 'Mer' },
  { key: 'thu', label: 'Gio' },
  { key: 'fri', label: 'Ven' },
  { key: 'sat', label: 'Sab' },
  { key: 'sun', label: 'Dom' },
];

const defaultShift: WorkingHoursShift = { open: '09:00', close: '19:00' };
const defaultDay: WorkingHoursShift[] = [{ ...defaultShift }];

export default function StaffPage() {
  const [stylists, setStylists] = useState<any[]>([]);
  const [salonId, setSalonId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openHours, setOpenHours] = useState<Set<string>>(new Set());
  const [openServices, setOpenServices] = useState<Set<string>>(new Set());
  const [hours, setHours] = useState<Record<string, Record<string, WorkingHoursShift[] | null>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newStylist, setNewStylist] = useState({ full_name: '', email: '', password: '' });
  const [creating, setCreating] = useState(false);
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [allServicesMode, setAllServicesMode] = useState<Record<string, boolean>>({});
  const [savingServices, setSavingServices] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (!users?.salon_id) return;
      setSalonId(users.salon_id);
      const { data: staff } = await supabase.from('users').select('id, full_name, email, role, working_hours, is_active').eq('salon_id', users.salon_id).eq('role', 'stylist').order('full_name');
      setStylists(staff || []);
      const h: Record<string, Record<string, WorkingHoursShift[] | null>> = {};
      (staff || []).forEach((s: any) => {
        const raw = s.working_hours || {};
        const normalized: Record<string, WorkingHoursShift[] | null> = {};
        for (const [day, value] of Object.entries(raw)) {
          normalized[day] = normalizeShifts(value);
        }
        // Ensure all 7 days exist
        for (const d of DAYS) {
          if (!(d.key in normalized)) normalized[d.key] = null;
        }
        h[s.id] = normalized;
      });
      setHours(h);

      // Load services
      const { data: svcs } = await supabase.from('services').select('*').eq('salon_id', users.salon_id).order('name');
      setAllServices(svcs || []);

      // Load assignments for all stylists
      const { data: assignData } = await supabase.from('stylist_services').select('stylist_id, service_id');
      const assignMap: Record<string, string[]> = {};
      (staff || []).forEach((s: any) => { assignMap[s.id] = []; });
      (assignData || []).forEach((a: any) => {
        if (assignMap[a.stylist_id]) assignMap[a.stylist_id].push(a.service_id);
      });
      setAssignments(assignMap);

      // Initialize allServicesMode: true if stylist has zero assignments
      const modeMap: Record<string, boolean> = {};
      (staff || []).forEach((s: any) => {
        modeMap[s.id] = (assignMap[s.id] || []).length === 0;
      });
      setAllServicesMode(modeMap);
    });
  }, []);

  function toggleDay(stylistId: string, key: string) {
    setHours(prev => ({
      ...prev,
      [stylistId]: {
        ...prev[stylistId],
        [key]: prev[stylistId]?.[key] ? null : [{ ...defaultShift }]
      }
    }));
  }

  function updateShift(stylistId: string, dayKey: string, shiftIdx: number, field: 'open' | 'close', value: string) {
    setHours(prev => {
      const stylistHours = { ...prev[stylistId] };
      const dayShifts = [...(stylistHours[dayKey] || [{ ...defaultShift }])];
      dayShifts[shiftIdx] = { ...dayShifts[shiftIdx], [field]: value };
      stylistHours[dayKey] = dayShifts;
      return { ...prev, [stylistId]: stylistHours };
    });
  }

  function addShift(stylistId: string, dayKey: string) {
    setHours(prev => {
      const stylistHours = { ...prev[stylistId] };
      const dayShifts = [...(stylistHours[dayKey] || [{ ...defaultShift }])];
      // Default new shift: 1 hour after the last one ends
      const lastClose = dayShifts[dayShifts.length - 1]?.close || '13:00';
      const [h, m] = lastClose.split(':').map(Number);
      const newOpen = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const newClose = `${String((h + 5) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      dayShifts.push({ open: newOpen, close: newClose });
      stylistHours[dayKey] = dayShifts;
      return { ...prev, [stylistId]: stylistHours };
    });
  }

  function removeShift(stylistId: string, dayKey: string, shiftIdx: number) {
    setHours(prev => {
      const stylistHours = { ...prev[stylistId] };
      const dayShifts = [...(stylistHours[dayKey] || [])];
      dayShifts.splice(shiftIdx, 1);
      stylistHours[dayKey] = dayShifts.length > 0 ? dayShifts : null;
      return { ...prev, [stylistId]: stylistHours };
    });
  }

  async function saveStylist(id: string) {
    setSaving(id);
    await supabase.from('users').update({ working_hours: hours[id] || {} }).eq('id', id);
    setSaving(null);
    sessionStorage.setItem('staff_updated', Date.now().toString());
    toast.success('Orari salvati');
    router.refresh();
  }

  function toggleService(stylistId: string, serviceId: string) {
    setAssignments(prev => {
      const current = prev[stylistId] || [];
      const updated = current.includes(serviceId)
        ? current.filter(id => id !== serviceId)
        : [...current, serviceId];
      return { ...prev, [stylistId]: updated };
    });
  }

  async function saveServices(stylistId: string) {
    setSavingServices(stylistId);
    const serviceIds = assignments[stylistId] || [];
    await fetch('/api/stylist-services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stylist_id: stylistId, service_ids: serviceIds }),
    });
    setSavingServices(null);
    toast.success('Servizi salvati');
  }

  async function toggleActive(stylistId: string, current: boolean) {
    const newState = !current;
    setStylists(prev => prev.map(s => s.id === stylistId ? { ...s, is_active: newState } : s));
    await supabase.from('users').update({ is_active: newState }).eq('id', stylistId);
    toast.success(newState ? 'Operatore attivato' : 'Operatore disattivato');
  }

  async function createStylist() {
    if (!newStylist.full_name || !newStylist.email || !newStylist.password) {
      toast.error('Compila tutti i campi');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStylist),
      });
      if (res.ok) {
        toast.success('Operatore creato');
        setNewStylist({ full_name: '', email: '', password: '' });
        setShowNewForm(false);
        const { data: staff } = await supabase.from('users').select('id, full_name, email, role, working_hours, is_active').eq('salon_id', salonId).eq('role', 'stylist').order('full_name');
        setStylists(staff || []);
        const h: Record<string, Record<string, WorkingHoursShift[] | null>> = {};
        (staff || []).forEach((s: any) => {
          const raw = s.working_hours || {};
          const normalized: Record<string, WorkingHoursShift[] | null> = {};
          for (const [day, value] of Object.entries(raw)) {
            normalized[day] = normalizeShifts(value);
          }
          for (const d of DAYS) {
            if (!(d.key in normalized)) normalized[d.key] = null;
          }
          h[s.id] = normalized;
        });
        setHours(prev => ({ ...prev, ...h }));
      } else {
        const err = await res.json();
        toast.error(err.error || 'Errore creazione');
      }
    } catch {
      toast.error('Errore di connessione');
    }
    setCreating(false);
  }

  const activeStylists = stylists.filter(s => s.is_active !== false);
  const inactiveStylists = stylists.filter(s => s.is_active === false);

  function renderStylist(stylist: any) {
    return (
      <div key={stylist.id} className="bg-white rounded-xl border overflow-hidden">
        <button
          onClick={() => setExpanded(expanded === stylist.id ? null : stylist.id)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-700">
              {stylist.full_name.split(' ')[0][0]}{stylist.full_name.split(' ')[1]?.[0] || ''}
            </div>
            <div className="text-left">
              <div className="font-semibold">{stylist.full_name}</div>
              <div className="text-sm text-gray-500">{stylist.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={(e) => { e.stopPropagation(); toggleActive(stylist.id, stylist.is_active !== false); }}
              className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                stylist.is_active !== false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-50 text-red-500 hover:bg-red-100'
              }`}>
              {stylist.is_active !== false ? 'Attivo' : 'Disattivato'}
            </button>
            <span className="text-sm text-gray-400">{expanded === stylist.id ? 'Chiudi' : 'Modifica →'}</span>
          </div>
        </button>

        {expanded === stylist.id && (
          <div className="border-t">
            <button
              onClick={() => setOpenHours(prev => {
                const next = new Set(prev);
                next.has(stylist.id) ? next.delete(stylist.id) : next.add(stylist.id);
                return next;
              })}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Clock size={14} /> Orari settimanali
              </span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${openHours.has(stylist.id) ? 'rotate-180' : ''}`} />
            </button>
            {openHours.has(stylist.id) && (
              <div className="px-4 pb-4 bg-gray-50/50">
                <p className="text-xs text-gray-400 mb-2">Clicca su un giorno per attivarlo. Aggiungi una seconda fascia per la pausa pranzo.</p>
                <div className="space-y-2">
                  {DAYS.map(day => {
                    const dayShifts = hours[stylist.id]?.[day.key];
                    const isActive = dayShifts !== null && dayShifts !== undefined;
                    return (
                      <div key={day.key} className={`p-2 rounded-lg ${isActive ? 'bg-blue-50/50' : 'bg-gray-100'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <button onClick={() => toggleDay(stylist.id, day.key)}
                            className={`w-14 text-center px-2 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
                              isActive ? 'bg-blue-600 text-white' : 'bg-white border text-gray-400'
                            }`}>
                            {day.label}
                          </button>
                          {!isActive && (
                            <span className="text-xs text-gray-400">Non disponibile</span>
                          )}
                          {isActive && dayShifts && dayShifts.length < 2 && (
                            <button onClick={() => addShift(stylist.id, day.key)}
                              className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-0.5 ml-auto">
                              <Plus size={10} /> Aggiungi fascia pausa
                            </button>
                          )}
                        </div>
                        {isActive && dayShifts && (
                          <div className="space-y-1 ml-16">
                            {dayShifts.map((shift, si) => (
                              <div key={si} className="flex items-center gap-1.5">
                                <input type="time" value={shift.open}
                                  onChange={e => updateShift(stylist.id, day.key, si, 'open', e.target.value)}
                                  className="px-2 py-1 border rounded text-xs w-24" />
                                <span className="text-gray-400 text-xs">–</span>
                                <input type="time" value={shift.close}
                                  onChange={e => updateShift(stylist.id, day.key, si, 'close', e.target.value)}
                                  className="px-2 py-1 border rounded text-xs w-24" />
                                {dayShifts.length > 1 && (
                                  <button onClick={() => removeShift(stylist.id, day.key, si)}
                                    className="p-0.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                                    title="Rimuovi fascia">
                                    <Minus size={12} />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => saveStylist(stylist.id)} disabled={saving === stylist.id}
                  className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving === stylist.id ? 'Salvataggio...' : 'Salva orari'}
                </button>
              </div>
            )}
            <button
              onClick={() => setOpenServices(prev => {
                const next = new Set(prev);
                next.has(stylist.id) ? next.delete(stylist.id) : next.add(stylist.id);
                return next;
              })}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors border-t">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Scissors size={14} /> Servizi
              </span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${openServices.has(stylist.id) ? 'rotate-180' : ''}`} />
            </button>
            {openServices.has(stylist.id) && (
              <div className="px-4 pb-4 bg-gray-50/50">
                {allServices.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">Nessun servizio configurato</p>
                ) : (
                  <>
                    <label className="flex items-center gap-2 p-2 bg-white rounded-lg border cursor-pointer text-sm font-medium">
                      <input type="checkbox"
                        checked={allServicesMode[stylist.id] !== false}
                        onChange={async () => {
                          const isAll = allServicesMode[stylist.id] !== false;
                          if (isAll) {
                            setAllServicesMode(prev => ({ ...prev, [stylist.id]: false }));
                          } else {
                            setAllServicesMode(prev => ({ ...prev, [stylist.id]: true }));
                            setAssignments(prev => ({ ...prev, [stylist.id]: [] }));
                            setSavingServices(stylist.id);
                            await fetch('/api/stylist-services', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ stylist_id: stylist.id, service_ids: [] }),
                            });
                            setSavingServices(null);
                            toast.success('Operatore abilitato a tutti i servizi');
                          }
                        }}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span>Tutti i servizi</span>
                    </label>
                    {allServicesMode[stylist.id] === false && (
                      <div className="space-y-1 mt-2 max-h-48 overflow-y-auto">
                        {allServices.map(svc => {
                          const checked = (assignments[stylist.id] || []).includes(svc.id);
                          return (
                            <label key={svc.id} className="flex items-center gap-2 p-1.5 hover:bg-white rounded-lg cursor-pointer text-sm">
                              <input type="checkbox" checked={checked}
                                onChange={() => toggleService(stylist.id, svc.id)}
                                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: svc.color_hex }} />
                              <span>{svc.name}</span>
                              <span className="text-gray-400 text-xs ml-auto">{svc.duration_minutes}min</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400 mt-2">
                      {allServicesMode[stylist.id] !== false
                        ? 'Operatore abilitato a tutti i servizi'
                        : `${(assignments[stylist.id] || []).length} servizio/i assegnato/i`}
                    </p>
                    <button onClick={() => saveServices(stylist.id)} disabled={savingServices === stylist.id}
                      className="mt-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                      {savingServices === stylist.id ? 'Salvataggio...' : 'Salva servizi'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Users size={24} /> Staff</h1>
        <button onClick={() => setShowNewForm(!showNewForm)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus size={16} /> Aggiungi operatore
        </button>
      </div>

      {showNewForm && (
        <div className="bg-white rounded-xl border p-4 mb-6">
          <h3 className="font-semibold text-sm text-gray-700 mb-3">Nuovo operatore</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <input type="text" placeholder="Nome e cognome *" value={newStylist.full_name}
              onChange={e => setNewStylist({ ...newStylist, full_name: e.target.value })}
              className="px-3 py-2 border rounded-lg text-sm" />
            <input type="email" placeholder="Email *" value={newStylist.email}
              onChange={e => setNewStylist({ ...newStylist, email: e.target.value })}
              className="px-3 py-2 border rounded-lg text-sm" />
            <input type="password" placeholder="Password *" value={newStylist.password}
              onChange={e => setNewStylist({ ...newStylist, password: e.target.value })}
              className="px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowNewForm(false); setNewStylist({ full_name: '', email: '', password: '' }); }}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Annulla</button>
            <button onClick={createStylist} disabled={creating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
              {creating ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
              {creating ? 'Creazione...' : 'Crea operatore'}
            </button>
          </div>
        </div>
      )}

      {stylists.length === 0 && (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
          <Users size={32} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium">Nessun operatore</p>
          <p className="text-sm mt-1">Clicca "Aggiungi operatore" per creare il primo membro dello staff.</p>
        </div>
      )}

      {activeStylists.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-gray-500 mb-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" /> Attivi
          </h3>
          <div className="space-y-4 mb-8">
            {activeStylists.map(renderStylist)}
          </div>
        </>
      )}

      {inactiveStylists.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gray-400" /> Disattivati
          </h3>
          <div className="space-y-4 opacity-60">
            {inactiveStylists.map(renderStylist)}
          </div>
        </>
      )}

    </div>
  );
}
