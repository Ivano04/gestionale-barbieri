'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarDays, Users, Euro, TrendingUp, Clock, Target } from 'lucide-react';
import Link from 'next/link';

interface Stats {
  today: { appointments: number; clients: number; revenue: number };
  month: { appointments: number; clients: number; revenue: number; avgTicket: number };
  year: { appointments: number; clients: number; revenue: number };
  avgReturnDays: number | null;
  channels: Record<string, number>;
}

const channelLabels: Record<string, string> = {
  widget: '📱 Sito', manual: '✍️ Manuale', phone: '📞 Tel', google: '🔍 Google',
  treatwell: '📋 Treatwell', walk_in: '🚶 Walk-in', whatsapp: '💬 WA',
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [salonId, setSalonId] = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (!users?.salon_id) return;
      setSalonId(users.salon_id);
      const res = await fetch(`/api/stats?salon_id=${users.salon_id}`);
      const data2 = await res.json();
      if (!data2.error) setStats(data2);
    });
  }, []);

  if (!stats) return <div className="p-8 text-center text-gray-400">Caricamento dashboard...</div>;

  const cards = [
    { label: 'Appuntamenti oggi', value: stats.today.appointments, sub: `${stats.today.clients} clienti`, icon: CalendarDays, color: 'bg-blue-50 text-blue-700' },
    { label: 'Fatturato mese', value: `€${stats.month.revenue.toFixed(0)}`, sub: `Ticket medio €${stats.month.avgTicket.toFixed(0)}`, icon: Euro, color: 'bg-green-50 text-green-700' },
    { label: 'Clienti mese', value: stats.month.clients, sub: `${stats.year.clients} quest'anno`, icon: Users, color: 'bg-purple-50 text-purple-700' },
    { label: 'Ritorno medio', value: stats.avgReturnDays ? `${stats.avgReturnDays}g` : '—', sub: 'Tra una visita e l\'altra', icon: Clock, color: 'bg-orange-50 text-orange-700' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/calendar" className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <CalendarDays size={16} /> Vai al calendario
        </Link>
      </div>

      {/* KPI Cards */}
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
        {/* Revenue chart (text-based for now) */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-green-600" /> Panoramica
          </h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Oggi</span>
                <span className="font-medium">€{stats.today.revenue.toFixed(0)} · {stats.today.appointments} appuntamenti</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, (stats.today.appointments / Math.max(1, stats.month.appointments / 30)) * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Mese</span>
                <span className="font-medium">€{stats.month.revenue.toFixed(0)} · {stats.month.appointments} appuntamenti</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, (stats.month.appointments / Math.max(1, stats.year.appointments / 12)) * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Anno</span>
                <span className="font-medium">€{stats.year.revenue.toFixed(0)} · {stats.year.appointments} appuntamenti</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.min(100, (stats.year.appointments / 2000) * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Channel breakdown */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Target size={18} className="text-blue-600" /> Canali di acquisizione (mese)
          </h3>
          {Object.keys(stats.channels).length === 0 ? (
            <p className="text-gray-400 text-sm">Nessun dato questo mese</p>
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
    </div>
  );
}
