'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Search, Plus, X, Pencil, Trash2, History, Phone } from 'lucide-react';
import type { Client, Appointment } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [salonId, setSalonId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', email: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [history, setHistory] = useState<{ client: Client; appointments: Appointment[] } | null>(null);
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

  function openNew() {
    setEditing(null);
    setForm({ first_name: '', last_name: '', phone: '', email: '', notes: '' });
    setShowForm(true);
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({ first_name: c.first_name, last_name: c.last_name, phone: c.phone || '', email: c.email || '', notes: c.notes || '' });
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.first_name || !form.last_name || !form.phone) return;
    setSaving(true);
    if (editing) {
      await supabase.from('clients').update(form).eq('id', editing.id);
    } else {
      await supabase.from('clients').insert({ salon_id: salonId, ...form });
    }
    setSaving(false);
    setShowForm(false);
    loadClients(salonId);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    // Check if client has appointments
    const { data: apps } = await supabase.from('appointments').select('id').eq('client_id', id).limit(1);
    if (apps?.length) {
      // Soft delete: just mark as inactive (or we could disallow)
      if (!confirm('Questo cliente ha appuntamenti. Vuoi comunque eliminarlo?')) { setDeleting(null); return; }
    }
    await supabase.from('clients').delete().eq('id', id);
    setDeleting(null);
    loadClients(salonId);
  }

  async function showHistory(c: Client) {
    const { data: apps } = await supabase
      .from('appointments')
      .select('*, service:services(*), stylist:users(full_name)')
      .eq('client_id', c.id)
      .order('start_time', { ascending: false });
    setHistory({ client: c, appointments: apps || [] });
  }

  // Filter: search by name OR phone
  const filtered = clients.filter(c => {
    const q = search.toLowerCase();
    return `${c.first_name} ${c.last_name} ${c.phone || ''}`.toLowerCase().includes(q);
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Clienti</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Cerca nome o telefono..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-72 text-sm" />
          </div>
          <button onClick={openNew}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus size={16} /> Nuovo cliente
          </button>
        </div>
      </div>

      {/* Client Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{editing ? 'Modifica cliente' : 'Nuovo Cliente'}</h3>
              <button onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="flex gap-3">
                <input type="text" placeholder="Nome *" value={form.first_name}
                  onChange={e => setForm({ ...form, first_name: e.target.value })} required
                  className="flex-1 px-4 py-2 border rounded-lg text-sm" />
                <input type="text" placeholder="Cognome *" value={form.last_name}
                  onChange={e => setForm({ ...form, last_name: e.target.value })} required
                  className="flex-1 px-4 py-2 border rounded-lg text-sm" />
              </div>
              <input type="tel" placeholder="Telefono * (identificativo univoco)" value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })} required
                className="w-full px-4 py-2 border rounded-lg text-sm" />
              <input type="email" placeholder="Email" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg text-sm" />
              <textarea placeholder="Note (es. capelli lisci, allergie...)" value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg text-sm" rows={2} />
              <button type="submit" disabled={saving}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Salvataggio...' : editing ? 'Aggiorna cliente' : 'Aggiungi cliente'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Client History Modal */}
      {history && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setHistory(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 mx-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">{history.client.first_name} {history.client.last_name}</h3>
                <p className="text-sm text-gray-500">{history.client.phone}</p>
              </div>
              <button onClick={() => setHistory(null)}><X size={20} /></button>
            </div>
            {history.appointments.length === 0 ? (
              <p className="text-gray-400 text-center py-4">Nessun appuntamento passato</p>
            ) : (
              <div className="space-y-2">
                {history.appointments.map(a => (
                  <div key={a.id} className="flex items-center justify-between p-3 border rounded-lg text-sm">
                    <div>
                      <div className="font-medium">{a.service?.name || 'Servizio'}</div>
                      <div className="text-gray-500 text-xs">
                        {format(parseISO(a.start_time), 'dd/MM/yy HH:mm')}
                        {a.stylist?.full_name && ` · ${(a.stylist as any).full_name}`}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      a.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                      a.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                      a.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {a.status === 'confirmed' ? 'Confermato' :
                       a.status === 'completed' ? 'Completato' :
                       a.status === 'cancelled' ? 'Cancellato' :
                       a.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Client Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b text-left text-sm text-gray-500">
              <th className="p-3 font-medium w-8"></th>
              <th className="p-3 font-medium">Nome</th>
              <th className="p-3 font-medium">Telefono</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Note</th>
              <th className="p-3 font-medium w-28">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-b hover:bg-gray-50 text-sm">
                <td className="p-3">
                  <button onClick={() => showHistory(c)} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-500" title="Storico">
                    <History size={14} />
                  </button>
                </td>
                <td className="p-3 font-medium">{c.first_name} {c.last_name}</td>
                <td className="p-3 text-gray-600 font-mono text-xs">{c.phone || '—'}</td>
                <td className="p-3 text-gray-600 text-xs">{c.email || '—'}</td>
                <td className="p-3 text-gray-500 text-xs max-w-[200px] truncate">{c.notes || '—'}</td>
                <td className="p-3">
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Modifica">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(c.id)} disabled={deleting === c.id}
                      className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg disabled:opacity-30" title="Elimina">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-12 text-center text-gray-400">
            {search ? 'Nessun cliente trovato' : 'Nessun cliente. Aggiungi il primo!'}
          </div>
        )}
      </div>
    </div>
  );
}
