import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  if (!salon_id) return Response.json({ error: 'salon_id required' }, { status: 400 });

  const supabase = createAdminClient();
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, client_id, service_id, start_time, status, source, service:services(price_cents, name)')
    .eq('salon_id', salon_id)
    .in('status', ['confirmed', 'completed'])
    .order('start_time', { ascending: false });

  if (!appointments) return Response.json({ error: 'No data' }, { status: 500 });

  const todayApps = appointments.filter(a => new Date(a.start_time) >= dayStart);
  const monthApps = appointments.filter(a => new Date(a.start_time) >= monthStart);
  const yearApps = appointments.filter(a => new Date(a.start_time) >= yearStart);

  const monthClientIds = new Set(monthApps.map(a => a.client_id).filter(Boolean));
  const yearClientIds = new Set(yearApps.map(a => a.client_id).filter(Boolean));

  const avgTicket = monthApps.length > 0
    ? monthApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / monthApps.length / 100
    : 0;

  const monthlyRevenue = monthApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / 100;
  const yearlyRevenue = yearApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / 100;

  // LTV: total spent per client, averaged
  const clientSpending: Record<string, number> = {};
  for (const a of appointments) {
    if (!a.client_id) continue;
    clientSpending[a.client_id] = (clientSpending[a.client_id] || 0) + ((a.service as any)?.price_cents || 0);
  }
  const clientCount = Object.keys(clientSpending).length;
  const avgLTV = clientCount > 0
    ? Math.round(Object.values(clientSpending).reduce((s, v) => s + v, 0) / clientCount / 100)
    : 0;

  const channelCounts: Record<string, number> = {};
  for (const a of monthApps) {
    channelCounts[a.source] = (channelCounts[a.source] || 0) + 1;
  }

  return Response.json({
    today: {
      appointments: todayApps.length,
      clients: new Set(todayApps.map(a => a.client_id).filter(Boolean)).size,
      revenue: todayApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / 100,
    },
    month: { appointments: monthApps.length, clients: monthClientIds.size, revenue: monthlyRevenue, avgTicket },
    year: { appointments: yearApps.length, clients: yearClientIds.size, revenue: yearlyRevenue },
    avgLTV,
    channels: channelCounts,
  });
}
