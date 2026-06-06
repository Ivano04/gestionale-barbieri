'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Users, Clock, Plus, Loader2 } from 'lucide-react';
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

const defaultDay = { open: '09:00', close: '19:00' };

export default function StaffPage() {
  const [stylists, setStylists] = useState<any[]>([]);
  const [salonId, setSalonId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hours, setHours] = useState<Record<string, Record<string, { open: string; close: string } | null>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newStylist, setNewStylist] = useState({ full_name: '', email: '', password: '' });
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (!users?.salon_id) return;
      setSalonId(users.salon_id);
      const { data: staff } = await supabase.from('users').select('id, full_name, email, role, working_hours').eq('salon_id', users.salon_id).eq('role', 'stylist').order('full_name');
      setStylists(staff || []);
      const h: Record<string, any> = {};
      (staff || []).forEach(s => {
        h[s.id] = s.working_hours || {};
      });
      setHours(h);
    });
  }, []);

  function toggleDay(stylistId: string, key: string) {
    setHours(prev => ({
      ...prev,
      [stylistId]: {
        ...prev[stylistId],
        [key]: prev[stylistId]?.[key] ? null : { ...defaultDay }
      }
    }));
  }

  function updateDay(stylistId: string, key: string, field: 'open' | 'close', value: string) {
    setHours(prev => ({
      ...prev,
      [stylistId]: {
        ...prev[stylistId],
        [key]: { ...(prev[stylistId]?.[key] || defaultDay), [field]: value }
      }
    }));
  }

  async function saveStylist(id: string) {
    setSaving(id);
    await supabase.from('users').update({ working_hours: hours[id] || {} }).eq('id', id);
    setSaving(null);
    // Segnala al calendario che i dati sono cambiati
    sessionStorage.setItem('staff_updated', Date.now().toString());
    toast.success('Orari salvati');
    router.refresh();
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
        // Reload the staff list
        const { data: staff } = await supabase.from('users').select('id, full_name, email, role, working_hours').eq('salon_id', salonId).eq('role', 'stylist').order('full_name');
        setStylists(staff || []);
        const h: Record<string, any> = {};
        (staff || []).forEach((s: any) => { h[s.id] = s.working_hours || {}; });
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

      <div className="space-y-4">
        {stylists.length === 0 && (
          <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
            <Users size={32} className="mx-auto mb-3 opacity-40" />
            <p className="font-medium">Nessun operatore</p>
            <p className="text-sm mt-1">Clicca "Aggiungi operatore" per creare il primo membro dello staff.</p>
          </div>
        )}
        {stylists.map(stylist => (
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
              <span className="text-sm text-gray-400">{expanded === stylist.id ? 'Chiudi' : 'Orari →'}</span>
            </button>

            {expanded === stylist.id && (
              <div className="border-t p-4 bg-gray-50/50">
                <h4 className="text-sm font-medium text-gray-500 mb-3 flex items-center gap-2">
                  <Clock size={14} /> Orari settimanali
                </h4>
                <div className="space-y-1.5">
                  {DAYS.map(day => {
                    const dayHours = hours[stylist.id]?.[day.key];
                    const isActive = dayHours !== null && dayHours !== undefined;
                    return (
                      <div key={day.key} className={`flex items-center gap-2 p-1.5 rounded-lg ${isActive ? 'bg-blue-50/50' : 'bg-gray-100'}`}>
                        <button onClick={() => toggleDay(stylist.id, day.key)}
                          className={`w-14 text-center px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            isActive ? 'bg-blue-600 text-white' : 'bg-white border text-gray-400'
                          }`}>
                          {day.label}
                        </button>
                        {isActive && dayHours ? (
                          <div className="flex items-center gap-1.5">
                            <input type="time" value={dayHours.open}
                              onChange={e => updateDay(stylist.id, day.key, 'open', e.target.value)}
                              className="px-2 py-1 border rounded text-xs w-24" />
                            <span className="text-gray-400 text-xs">–</span>
                            <input type="time" value={dayHours.close}
                              onChange={e => updateDay(stylist.id, day.key, 'close', e.target.value)}
                              className="px-2 py-1 border rounded text-xs w-24" />
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">Non disponibile</span>
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
          </div>
        ))}
      </div>
    </div>
  );
}
