'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarDays, Users, Euro, TrendingUp, Clock, Target, ArrowRight, Trash2 } from 'lucide-react';
import type { Appointment } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import Link from 'next/link';

interface Stats {
  today: { appointments: number; clients: number; revenue: number };
  month: { appointments: number; clients: number; revenue: number; avgTicket: number };
  year: { appointments: number; clients: number; revenue: number };
  avgLTV: number;
  channels: Record<string, number>;
}

const channelLabels: Record<string, string> = {
  widget: '📱 Sito', manual: '✍️ Manuale', phone: '📞 Tel', google: '🔍 Google',
  treatwell: '📋 Treatwell', walk_in: '🚶 Walk-in', whatsapp: '💬 WA',
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [salonId, setSalonId] = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (!users?.salon_id) return;
      setSalonId(users.salon_id);
      const [statsRes, appsRes] = await Promise.all([
        fetch(`/api/stats?salon_id=${users.salon_id}`).then(r => r.json()),
        supabase.from('appointments')
          .select('*, client:clients(*), service:services(*), stylist:users(*)')
          .eq('salon_id', users.salon_id)
          .eq('status', 'confirmed')
          .gte('start_time', new Date().toISOString())
          .order('start_time')
          .limit(30),
      ]);
      if (!statsRes.error) setStats(statsRes);
      if (appsRes.data) setUpcoming(appsRes.data);
    });
  }, []);

  async function cancelAppointment(id: string) {
    if (!confirm('Sicuro di voler cancellare questo appuntamento?')) return;
    setUpcoming(prev => prev.map(a => a.id === id ? { ...a, status: 'cancelled' } : a));
    await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
    setStats(prev => prev ? {
      ...prev,
      today: { ...prev.today, appointments: prev.today.appointments - 1 }
    } : null);
  }

  if (!stats) return <div className="p-8 text-center text-gray-400">Caricamento dashboard...</div>;

  const cards = [
    { label: 'Appuntamenti oggi', value: stats.today.appointments, sub: `${stats.today.clients} clienti`, icon: CalendarDays, color: 'bg-blue-50 text-blue-700' },
    { label: 'Fatturato mese', value: `€${stats.month.revenue.toFixed(0)}`, sub: `Ticket medio €${stats.month.avgTicket.toFixed(0)}`, icon: Euro, color: 'bg-green-50 text-green-700' },
    { label: 'Clienti mese', value: stats.month.clients, sub: `${stats.year.clients} quest'anno`, icon: Users, color: 'bg-purple-50 text-purple-700' },
    { label: 'LTV medio', value: `€${stats.avgLTV}`, sub: 'Valore vita cliente', icon: TrendingUp, color: 'bg-orange-50 text-orange-700' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/calendar" className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <CalendarDays size={16} /> Vai al calendario
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((card, i) => (
          <div key={i} className="bg-white rounded-xl border p-5 hover:shadow-md transition-shadow">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${card.color}`}>
              <card.icon size={20} />
            </div>
            <div className="text-2xl font-bold mb-1">{card.value}</div>
            <div className="text-sm text-gray-500">{card.label}</div>
            <div className="text-xs text-gray-400 mt-1">{card.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-green-600" /> Panoramica
          </h3>
          <div className="space-y-4">
            {[
              { label: 'Oggi', value: `€${stats.today.revenue.toFixed(0)} · ${stats.today.appointments} app` },
              { label: 'Mese', value: `€${stats.month.revenue.toFixed(0)} · ${stats.month.appointments} app` },
              { label: 'Anno', value: `€${stats.year.revenue.toFixed(0)} · ${stats.year.appointments} app` },
            ].map((row, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">{row.label}</span>
                  <span className="font-medium">{row.value}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${['bg-blue-500', 'bg-green-500', 'bg-purple-500'][i]}`}
                    style={{ width: `${Math.min(100, (i === 0 ? stats.today.appointments / 30 : i === 1 ? stats.month.appointments / 200 : stats.year.appointments / 2000) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Target size={18} className="text-blue-600" /> Canali (mese)
          </h3>
          {Object.keys(stats.channels).length === 0 ? (
            <p className="text-gray-400 text-sm">Nessun dato</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(stats.channels).sort(([, a], [, b]) => b - a).map(([channel, count]) => (
                <div key={channel}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{channelLabels[channel] || channel}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(count / stats.month.appointments) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Prossimi appuntamenti */}
      <div className="mt-6">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Clock size={18} className="text-blue-600" /> Prossimi 30 appuntamenti
        </h3>
        <div className="bg-white rounded-xl border overflow-hidden">
          {upcoming.length === 0 ? (
            <p className="p-6 text-center text-gray-400 text-sm">Nessun appuntamento in programma</p>
          ) : (
            <div className="divide-y max-h-[500px] overflow-auto">
              {upcoming.map(a => (
                <div key={a.id} className="flex items-center gap-4 p-3 hover:bg-gray-50 group">
                  <div className="w-1 h-10 rounded-full flex-shrink-0"
                    style={{ backgroundColor: a.service?.color_hex || '#60a5fa' }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{a.client?.first_name} {a.client?.last_name}</div>
                    <div className="text-xs text-gray-500">{a.service?.name} · {a.stylist?.full_name}</div>
                  </div>
                  <div className="text-sm font-semibold text-gray-700 text-right">
                    <div>{format(parseISO(a.start_time), 'dd/MM')}</div>
                    <div>{format(parseISO(a.start_time), 'HH:mm')}</div>
                  </div>
                  <button onClick={() => cancelAppointment(a.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 rounded-lg text-red-500 transition-opacity" title="Cancella">
                    <Trash2 size={14} />
                  </button>
                  <Link href="/calendar" className="text-blue-400 hover:bg-blue-50 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                    <ArrowRight size={16} />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
