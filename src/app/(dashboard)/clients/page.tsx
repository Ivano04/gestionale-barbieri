'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Search } from 'lucide-react';
import type { Client } from '@/lib/types';

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [salonId, setSalonId] = useState('');
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

  const filtered = clients.filter(c =>
    `${c.first_name} ${c.last_name} ${c.phone || ''}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Clienti</h1>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Cerca..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64 text-sm" />
        </div>
      </div>
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
