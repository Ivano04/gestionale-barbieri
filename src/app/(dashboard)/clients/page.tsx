'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Search, Plus, X } from 'lucide-react';
import type { Client } from '@/lib/types';

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [salonId, setSalonId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', email: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (users?.salon_id) {
        setSalonId(users.salon_id);
        loadClients(users.salon_id);
      }
    });
  }, []);

  async function loadClients(sid: string) {
    const { data } = await supabase.from('clients').select('*').eq('salon_id', sid).order('last_name');
    setClients(data || []);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.first_name || !form.last_name) return;
    setSaving(true);
    await supabase.from('clients').insert({ salon_id: salonId, ...form });
    setSaving(false);
    setShowForm(false);
    setForm({ first_name: '', last_name: '', phone: '', email: '', notes: '' });
    loadClients(salonId);
  }

  const filtered = clients.filter(c =>
    `${c.first_name} ${c.last_name} ${c.phone || ''}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Clienti</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Cerca..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64 text-sm" />
          </div>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus size={16} /> Nuovo cliente
          </button>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Nuovo Cliente</h3>
              <button onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleAdd} className="space-y-3">
              <input type="text" placeholder="Nome *" value={form.first_name}
                onChange={e => setForm({ ...form, first_name: e.target.value })} required
                className="w-full px-4 py-2 border rounded-lg text-sm" />
              <input type="text" placeholder="Cognome *" value={form.last_name}
                onChange={e => setForm({ ...form, last_name: e.target.value })} required
                className="w-full px-4 py-2 border rounded-lg text-sm" />
              <input type="tel" placeholder="Telefono" value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg text-sm" />
              <input type="email" placeholder="Email" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg text-sm" />
              <textarea placeholder="Note" value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg text-sm" rows={2} />
              <button type="submit" disabled={saving}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Salvataggio...' : 'Aggiungi cliente'}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b text-left text-sm text-gray-500">
              <th className="p-3 font-medium">Nome</th>
              <th className="p-3 font-medium">Telefono</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Sync</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-b hover:bg-gray-50 text-sm">
                <td className="p-3 font-medium">{c.first_name} {c.last_name}</td>
                <td className="p-3 text-gray-600">{c.phone || '—'}</td>
                <td className="p-3 text-gray-600">{c.email || '—'}</td>
                <td className="p-3">
                  {c.ghl_contact_id
                    ? <span className="text-green-600 text-xs bg-green-50 px-2 py-1 rounded-full">GHL ✓</span>
                    : <span className="text-gray-400 text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-8 text-center text-gray-400">Nessun cliente trovato</div>}
      </div>
    </div>
  );
}
