'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Plus, X, Pencil, Trash2, Scissors } from 'lucide-react';
import type { Service } from '@/lib/types';
import { toast } from 'sonner';

const DEFAULT_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#fb923c', '#f87171'];

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [salonId, setSalonId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState({
    name: '', duration_minutes: 30, price_cents: 0, color_hex: '#60a5fa',
    duration_application: 0, duration_processing: 0, duration_finishing: 0, buffer_time_minutes: 0,
  });
  const [saving, setSaving] = useState(false);
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [stylists, setStylists] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [savingAssignments, setSavingAssignments] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (users?.salon_id) {
        setSalonId(users.salon_id);
        loadServices(users.salon_id);

        // Load stylists
        const { data: staff } = await supabase.from('users')
          .select('id, full_name').eq('salon_id', users.salon_id).eq('role', 'stylist').order('full_name');
        setStylists(staff || []);

        // Load assignments (keyed by service_id -> stylist_ids[])
        const { data: assignData } = await supabase.from('stylist_services').select('stylist_id, service_id');
        const assignMap: Record<string, string[]> = {};
        (assignData || []).forEach((a: any) => {
          if (!assignMap[a.service_id]) assignMap[a.service_id] = [];
          assignMap[a.service_id].push(a.stylist_id);
        });
        setAssignments(assignMap);
      }
    });
  }, []);

  async function loadServices(sid: string) {
    const { data } = await supabase.from('services').select('*').eq('salon_id', sid).order('name');
    setServices(data || []);
  }

  function openNew() {
    setEditing(null);
    setForm({ name: '', duration_minutes: 30, price_cents: 0, color_hex: '#60a5fa', duration_application: 0, duration_processing: 0, duration_finishing: 0, buffer_time_minutes: 0 });
    setShowForm(true);
  }

  function openEdit(s: Service) {
    setEditing(s);
    setForm({
      name: s.name, duration_minutes: s.duration_minutes, price_cents: s.price_cents, color_hex: s.color_hex,
      duration_application: s.duration_application || 0,
      duration_processing: s.duration_processing || 0,
      duration_finishing: s.duration_finishing || 0,
      buffer_time_minutes: s.buffer_time_minutes || 0,
    });
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    if (editing) {
      await supabase.from('services').update(form).eq('id', editing.id);
    } else {
      await supabase.from('services').insert({ salon_id: salonId, ...form });
    }
    setSaving(false);
    setShowForm(false);
    loadServices(salonId);
  }

  async function handleDelete(id: string) {
    await supabase.from('services').delete().eq('id', id);
    loadServices(salonId);
  }

  function toggleStylist(serviceId: string, stylistId: string) {
    setAssignments(prev => {
      const current = prev[serviceId] || [];
      const updated = current.includes(stylistId)
        ? current.filter(id => id !== stylistId)
        : [...current, stylistId];
      return { ...prev, [serviceId]: updated };
    });
  }

  async function saveServiceAssignments(serviceId: string) {
    setSavingAssignments(serviceId);
    const selectedStylistIds = assignments[serviceId] || [];
    // Update each stylist's full assignment list
    for (const stylist of stylists) {
      const { data: current } = await supabase
        .from('stylist_services').select('service_id').eq('stylist_id', stylist.id);
      const currentIds = (current || []).map((r: any) => r.service_id);
      const shouldHaveIt = selectedStylistIds.includes(stylist.id);
      const hasIt = currentIds.includes(serviceId);

      if (shouldHaveIt && !hasIt) {
        await fetch('/api/stylist-services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stylist_id: stylist.id, service_ids: [...currentIds, serviceId] }),
        });
      } else if (!shouldHaveIt && hasIt) {
        await fetch('/api/stylist-services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stylist_id: stylist.id, service_ids: currentIds.filter(id => id !== serviceId) }),
        });
      }
    }
    setSavingAssignments(null);
    toast.success('Assegnazioni salvate');
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Servizi</h1>
        <button onClick={openNew}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus size={16} /> Nuovo servizio
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{editing ? 'Modifica servizio' : 'Nuovo Servizio'}</h3>
              <button onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <input type="text" placeholder="Nome servizio *" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} required
                className="w-full px-4 py-2 border rounded-lg text-sm" />
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500">Durata totale (min)</label>
                  <input type="number" value={form.duration_minutes}
                    onChange={e => setForm({ ...form, duration_minutes: parseInt(e.target.value) || 30 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500">Prezzo (€)</label>
                  <input type="number" step="0.01" value={form.price_cents / 100}
                    onChange={e => setForm({ ...form, price_cents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                    className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
                </div>
              </div>
              <div className="border-t pt-2 mt-2">
                <p className="text-xs text-gray-400 mb-2">Fasi del servizio (tempo di posa)</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Applicazione</label>
                    <input type="number" value={form.duration_application || ''} placeholder="0"
                      onChange={e => setForm({ ...form, duration_application: parseInt(e.target.value) || 0 })}
                      className="w-full px-2 py-1.5 border rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Posa (libero)</label>
                    <input type="number" value={form.duration_processing || ''} placeholder="0"
                      onChange={e => setForm({ ...form, duration_processing: parseInt(e.target.value) || 0 })}
                      className="w-full px-2 py-1.5 border rounded text-xs mt-0.5 bg-green-50" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Finitura</label>
                    <input type="number" value={form.duration_finishing || ''} placeholder="0"
                      onChange={e => setForm({ ...form, duration_finishing: parseInt(e.target.value) || 0 })}
                      className="w-full px-2 py-1.5 border rounded text-xs mt-0.5" />
                  </div>
                </div>
                <div className="mt-2">
                  <label className="text-xs text-gray-500">Buffer (min dopo fine)</label>
                  <input type="number" value={form.buffer_time_minutes || ''} placeholder="0"
                    onChange={e => setForm({ ...form, buffer_time_minutes: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Colore</label>
                <div className="flex gap-2 mt-1">
                  {DEFAULT_COLORS.map(c => (
                    <button key={c} type="button"
                      onClick={() => setForm({ ...form, color_hex: c })}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${form.color_hex === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <button type="submit" disabled={saving}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Salvataggio...' : editing ? 'Aggiorna' : 'Crea servizio'}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map(s => (
          <div key={s.id} className="bg-white rounded-xl border hover:shadow-md transition-shadow">
            <button onClick={() => setExpandedService(expandedService === s.id ? null : s.id)}
              className="w-full p-4 flex items-center gap-4 text-left">
              <div className="w-4 h-12 rounded-full" style={{ backgroundColor: s.color_hex }} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{s.name}</div>
                <div className="text-sm text-gray-500">{s.duration_minutes} min · €{(s.price_cents / 100).toFixed(2)}</div>
              </div>
              <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                <button onClick={() => openEdit(s)} className="p-2 hover:bg-gray-100 rounded-lg"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(s.id)} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={14} /></button>
              </div>
            </button>

            {expandedService === s.id && (
              <div className="border-t px-4 py-3 bg-gray-50/50">
                <h4 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
                  <Scissors size={14} /> Operatori
                </h4>
                {stylists.length === 0 ? (
                  <p className="text-xs text-gray-400">Nessun operatore configurato</p>
                ) : (
                  <div className="space-y-1">
                    {stylists.map(st => {
                      const checked = (assignments[s.id] || []).includes(st.id);
                      return (
                        <label key={st.id} className="flex items-center gap-2 p-1.5 hover:bg-white rounded-lg cursor-pointer text-sm">
                          <input type="checkbox" checked={checked}
                            onChange={() => toggleStylist(s.id, st.id)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          <span>{st.full_name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <button onClick={() => saveServiceAssignments(s.id)} disabled={savingAssignments === s.id}
                  className="mt-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                  {savingAssignments === s.id ? 'Salvataggio...' : 'Salva'}
                </button>
              </div>
            )}
          </div>
        ))}
        {services.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-400">
            <p className="mb-2">Nessun servizio configurato</p>
            <p className="text-sm">Crea il tuo primo servizio per poter prenotare appuntamenti</p>
          </div>
        )}
      </div>
    </div>
  );
}
