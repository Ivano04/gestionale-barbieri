'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Salon } from '@/lib/types';
import { Building2, Globe, Phone, Clock, Sun, Moon } from 'lucide-react';

export default function SettingsPage() {
  const [salon, setSalon] = useState<Salon | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (!users?.salon_id) return;
      const { data: salonData } = await supabase.from('salons').select('*').eq('id', users.salon_id).single();
      if (salonData) setSalon(salonData);
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!salon) return;
    setLoading(true);
    await supabase.from('salons').update({
      name: salon.name,
      address: salon.address,
      phone: salon.phone,
      open_time: salon.open_time,
      close_time: salon.close_time,
    }).eq('id', salon.id);
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!salon) return <div className="p-8 text-center text-gray-400">Caricamento...</div>;

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Impostazioni</h1>

      <form onSubmit={handleSave} className="bg-white rounded-lg border p-6 space-y-4">
        <div>
          <label className="text-sm text-gray-500 flex items-center gap-2">
            <Building2 size={14} /> Nome salone
          </label>
          <input type="text" value={salon.name}
            onChange={e => setSalon({ ...salon, name: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="text-sm text-gray-500 flex items-center gap-2">
            <Globe size={14} /> Slug (URL prenotazione)
          </label>
          <input type="text" value={salon.slug} disabled
            className="w-full px-4 py-2 border rounded-lg mt-1 bg-gray-50 text-gray-400" />
          <p className="text-xs text-gray-400 mt-1">gestionale-parrucchiere.vercel.app/book/{salon.slug}</p>
        </div>

        <div>
          <label className="text-sm text-gray-500 flex items-center gap-2">
            <Phone size={14} /> Telefono
          </label>
          <input type="text" value={salon.phone || ''}
            onChange={e => setSalon({ ...salon, phone: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="text-sm text-gray-500 flex items-center gap-2">
            <Building2 size={14} /> Indirizzo
          </label>
          <input type="text" value={salon.address || ''}
            onChange={e => setSalon({ ...salon, address: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm text-gray-500 flex items-center gap-2">
              <Sun size={14} /> Orario apertura
            </label>
            <input type="time" value={salon.open_time || '09:00'}
              onChange={e => setSalon({ ...salon, open_time: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex-1">
            <label className="text-sm text-gray-500 flex items-center gap-2">
              <Moon size={14} /> Orario chiusura
            </label>
            <input type="time" value={salon.close_time || '19:00'}
              onChange={e => setSalon({ ...salon, close_time: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-500 flex items-center gap-2">
            <Clock size={14} /> Timezone
          </label>
          <input type="text" value={salon.timezone} disabled
            className="w-full px-4 py-2 border rounded-lg mt-1 bg-gray-50 text-gray-400" />
        </div>

        <button type="submit" disabled={loading}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Salvataggio...' : saved ? 'Salvato ✓' : 'Salva modifiche'}
        </button>
      </form>
    </div>
  );
}
