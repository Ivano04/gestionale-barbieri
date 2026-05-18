'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Users, Clock } from 'lucide-react';

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
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><Users size={24} /> Staff</h1>

      <div className="space-y-4">
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
