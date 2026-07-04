'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Salon } from '@/lib/types';
import { Building2, Globe, Phone, Clock, Plus, Minus } from 'lucide-react';
import { normalizeShifts, type WorkingHoursShift } from '@/lib/working-hours';

const DAYS = [
  { key: 'mon', label: 'Lunedì' },
  { key: 'tue', label: 'Martedì' },
  { key: 'wed', label: 'Mercoledì' },
  { key: 'thu', label: 'Giovedì' },
  { key: 'fri', label: 'Venerdì' },
  { key: 'sat', label: 'Sabato' },
  { key: 'sun', label: 'Domenica' },
];

const defaultShift: WorkingHoursShift = { open: '09:00', close: '19:00' };

export default function SettingsPage() {
  const [salon, setSalon] = useState<Salon | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hours, setHours] = useState<Record<string, WorkingHoursShift[] | null>>({});
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (!users?.salon_id) return;
      const { data: salonData } = await supabase.from('salons').select('*').eq('id', users.salon_id).single();
      if (salonData) {
        setSalon(salonData);
        const raw = salonData.working_hours || {};
        const normalized: Record<string, WorkingHoursShift[] | null> = {};
        for (const day of DAYS) {
          if (day.key in raw) {
            normalized[day.key] = normalizeShifts(raw[day.key]);
          } else {
            // Default: weekdays open, sunday closed
            normalized[day.key] = day.key === 'sun' ? null : [{ ...defaultShift }];
          }
        }
        setHours(normalized);
      }
    });
  }, []);

  function toggleDay(key: string) {
    setHours(prev => ({
      ...prev,
      [key]: prev[key] ? null : [{ ...defaultShift }]
    }));
  }

  function updateShift(dayKey: string, shiftIdx: number, field: 'open' | 'close', value: string) {
    setHours(prev => {
      const dayShifts = [...(prev[dayKey] || [{ ...defaultShift }])];
      dayShifts[shiftIdx] = { ...dayShifts[shiftIdx], [field]: value };
      return { ...prev, [dayKey]: dayShifts };
    });
  }

  function addShift(dayKey: string) {
    setHours(prev => {
      const dayShifts = [...(prev[dayKey] || [{ ...defaultShift }])];
      const lastClose = dayShifts[dayShifts.length - 1]?.close || '13:00';
      const [h, m] = lastClose.split(':').map(Number);
      const newOpen = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const newClose = `${String((h + 5) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      dayShifts.push({ open: newOpen, close: newClose });
      return { ...prev, [dayKey]: dayShifts };
    });
  }

  function removeShift(dayKey: string, shiftIdx: number) {
    setHours(prev => {
      const dayShifts = [...(prev[dayKey] || [])];
      dayShifts.splice(shiftIdx, 1);
      return { ...prev, [dayKey]: dayShifts.length > 0 ? dayShifts : null };
    });
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
          <p className="text-xs text-gray-400 mb-4">Clicca su un giorno per attivarlo. Aggiungi una seconda fascia per la pausa pranzo.</p>
          <div className="space-y-2">
            {DAYS.map(day => {
              const dayShifts = hours[day.key];
              const isActive = dayShifts !== null && dayShifts !== undefined;
              return (
                <div key={day.key} className={`p-2 rounded-lg transition-colors ${isActive ? 'bg-blue-50/50' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-3 mb-1">
                    <button type="button" onClick={() => toggleDay(day.key)}
                      className={`w-28 text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isActive ? 'bg-blue-600 text-white' : 'bg-white border text-gray-400'
                      }`}>
                      {day.label}
                    </button>
                    {!isActive && (
                      <span className="text-sm text-gray-400">Chiuso</span>
                    )}
                    {isActive && dayShifts && dayShifts.length < 2 && (
                      <button type="button" onClick={() => addShift(day.key)}
                        className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-0.5 ml-auto">
                        <Plus size={10} /> Aggiungi fascia pausa
                      </button>
                    )}
                  </div>
                  {isActive && dayShifts && (
                    <div className="space-y-1 ml-[124px]">
                      {dayShifts.map((shift, si) => (
                        <div key={si} className="flex items-center gap-2">
                          <input type="time" value={shift.open}
                            onChange={e => updateShift(day.key, si, 'open', e.target.value)}
                            className="px-2 py-1.5 border rounded-lg text-sm w-28" />
                          <span className="text-gray-400 text-sm">–</span>
                          <input type="time" value={shift.close}
                            onChange={e => updateShift(day.key, si, 'close', e.target.value)}
                            className="px-2 py-1.5 border rounded-lg text-sm w-28" />
                          {dayShifts.length > 1 && (
                            <button type="button" onClick={() => removeShift(day.key, si)}
                              className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Rimuovi fascia">
                              <Minus size={14} />
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
        </div>

        <button type="submit" disabled={loading}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {loading ? 'Salvataggio...' : saved ? 'Salvato ✓' : 'Salva modifiche'}
        </button>
      </form>
    </div>
  );
}
