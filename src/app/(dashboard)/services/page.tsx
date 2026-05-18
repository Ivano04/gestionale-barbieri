'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Plus, X, Pencil, Trash2 } from 'lucide-react';
import type { Service } from '@/lib/types';

const DEFAULT_COLORS = ['#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#fb923c', '#f87171'];

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [salonId, setSalonId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState({ name: '', duration_minutes: 30, price_cents: 0, color_hex: '#60a5fa' });
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (users?.salon_id) {
        setSalonId(users.salon_id);
        loadServices(users.salon_id);
      }
    });
  }, []);

  async function loadServices(sid: string) {
    const { data } = await supabase.from('services').select('*').eq('salon_id', sid).order('name');
    setServices(data || []);
  }

  function openNew() {
    setEditing(null);
    setForm({ name: '', duration_minutes: 30, price_cents: 0, color_hex: '#60a5fa' });
    setShowForm(true);
  }

  function openEdit(s: Service) {
    setEditing(s);
    setForm({ name: s.name, duration_minutes: s.duration_minutes, price_cents: s.price_cents, color_hex: s.color_hex });
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
                  <label className="text-xs text-gray-500">Durata (min)</label>
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
          <div key={s.id} className="bg-white rounded-xl border p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="w-4 h-12 rounded-full" style={{ backgroundColor: s.color_hex }} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{s.name}</div>
              <div className="text-sm text-gray-500">{s.duration_minutes} min · €{(s.price_cents / 100).toFixed(2)}</div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => openEdit(s)} className="p-2 hover:bg-gray-100 rounded-lg"><Pencil size={14} /></button>
              <button onClick={() => handleDelete(s.id)} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={14} /></button>
            </div>
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
