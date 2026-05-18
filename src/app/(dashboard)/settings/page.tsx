'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Salon } from '@/lib/types';
import { Building2, Globe, Phone, Clock, Sun, Moon } from 'lucide-react';

const DAYS = [
  { key: 'mon', label: 'Lunedì' },
  { key: 'tue', label: 'Martedì' },
  { key: 'wed', label: 'Mercoledì' },
  { key: 'thu', label: 'Giovedì' },
  { key: 'fri', label: 'Venerdì' },
  { key: 'sat', label: 'Sabato' },
  { key: 'sun', label: 'Domenica' },
];

const defaultDay = { open: '09:00', close: '19:00' };

export default function SettingsPage() {
  const [salon, setSalon] = useState<Salon | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hours, setHours] = useState<Record<string, { open: string; close: string } | null>>({});
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (!users?.salon_id) return;
      const { data: salonData } = await supabase.from('salons').select('*').eq('id', users.salon_id).single();
      if (salonData) {
        setSalon(salonData);
        setHours(salonData.working_hours || { mon: defaultDay, tue: defaultDay, wed: defaultDay, thu: defaultDay, fri: defaultDay, sat: defaultDay, sun: null });
      }
    });
  }, []);

  function toggleDay(key: string) {
    setHours(prev => ({
      ...prev,
      [key]: prev[key] ? null : { ...defaultDay }
    }));
  }

  function updateDay(key: string, field: 'open' | 'close', value: string) {
    setHours(prev => ({
      ...prev,
      [key]: prev[key] ? { ...prev[key]!, [field]: value } : null
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!salon) return;
    setLoading(true);
    await supabase.from('salons').update({
      name: salon.name,
      address: salon.address,
      phone: salon.phone,
      working_hours: hours,
    }).eq('id', salon.id);
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!salon) return <div className="p-8 text-center text-gray-400">Caricamento...</div>;

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Impostazioni</h1>

      <form onSubmit={handleSave} className="space-y-6">
        {/* General info */}
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h3 className="font-semibold text-sm text-gray-700 mb-2">Info salone</h3>
          <div>
            <label className="text-sm text-gray-500 flex items-center gap-2"><Building2 size={14} /> Nome</label>
            <input type="text" value={salon.name} onChange={e => setSalon({ ...salon, name: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-sm text-gray-500 flex items-center gap-2"><Globe size={14} /> Slug</label>
            <input type="text" value={salon.slug} disabled className="w-full px-4 py-2 border rounded-lg mt-1 bg-gray-50 text-gray-400" />
            <p className="text-xs text-gray-400 mt-1">gestionale-parrucchiere.vercel.app/book/{salon.slug}</p>
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm text-gray-500 flex items-center gap-2"><Phone size={14} /> Telefono</label>
              <input type="text" value={salon.phone || ''} onChange={e => setSalon({ ...salon, phone: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex-1">
              <label className="text-sm text-gray-500 flex items-center gap-2"><Building2 size={14} /> Indirizzo</label>
              <input type="text" value={salon.address || ''} onChange={e => setSalon({ ...salon, address: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>

        {/* Weekly hours */}
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold text-sm text-gray-700 mb-3 flex items-center gap-2">
            <Clock size={14} /> Orari settimanali
          </h3>
          <p className="text-xs text-gray-400 mb-4">Clicca su un giorno per attivarlo/disattivarlo (chiuso)</p>
          <div className="space-y-2">
            {DAYS.map(day => {
              const isActive = Boolean(hours[day.key]);
              return (
                <div key={day.key} className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${isActive ? 'bg-blue-50/50' : 'bg-gray-50'}`}>
                  <button type="button" onClick={() => toggleDay(day.key)}
                    className={`w-28 text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive ? 'bg-blue-600 text-white' : 'bg-white border text-gray-400'
                    }`}>
                    {day.label}
                  </button>
                  {isActive ? (
                    <div className="flex items-center gap-2">
                      <input type="time" value={hours[day.key]!.open}
                        onChange={e => updateDay(day.key, 'open', e.target.value)}
                        className="px-2 py-1.5 border rounded-lg text-sm w-28" />
                      <span className="text-gray-400 text-sm">–</span>
                      <input type="time" value={hours[day.key]!.close}
                        onChange={e => updateDay(day.key, 'close', e.target.value)}
                        className="px-2 py-1.5 border rounded-lg text-sm w-28" />
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">Chiuso</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <button type="submit" disabled={loading}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {loading ? 'Salvataggio...' : saved ? 'Salvato ✓' : 'Salva modifiche'}
        </button>
      </form>
    </div>
  );
}
