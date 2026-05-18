import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const salon_id = searchParams.get('salon_id');
  const period = searchParams.get('period') || 'month'; // day | month | year

  if (!salon_id) return Response.json({ error: 'salon_id required' }, { status: 400 });

  const supabase = createAdminClient();
  const now = new Date();

  // Date ranges
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // All confirmed/completed appointments
  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, client_id, service_id, start_time, status, source, service:services(price_cents, name)')
    .eq('salon_id', salon_id)
    .in('status', ['confirmed', 'completed'])
    .order('start_time', { ascending: false });

  if (!appointments) return Response.json({ error: 'No data' }, { status: 500 });

  const now2 = new Date();
  const dayStart2 = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate());
  const monthStart2 = new Date(now2.getFullYear(), now2.getMonth(), 1);
  const yearStart2 = new Date(now2.getFullYear(), 0, 1);

  const todayApps = appointments.filter(a => new Date(a.start_time) >= dayStart2);
  const monthApps = appointments.filter(a => new Date(a.start_time) >= monthStart2);
  const yearApps = appointments.filter(a => new Date(a.start_time) >= yearStart2);

  // Unique clients this month
  const monthClientIds = new Set(monthApps.map(a => a.client_id).filter(Boolean));
  const yearClientIds = new Set(yearApps.map(a => a.client_id).filter(Boolean));

  // Average ticket (from services with price)
  const avgTicket = monthApps.length > 0
    ? monthApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / monthApps.length / 100
    : 0;

  // Monthly revenue
  const monthlyRevenue = monthApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / 100;
  const yearlyRevenue = yearApps.reduce((sum, a) => sum + ((a.service as any)?.price_cents || 0), 0) / 100;

  // Return frequency: avg days between appointments for clients with >1 visit
  const clientVisits: Record<string, Date[]> = {};
  for (const a of appointments) {
    if (!a.client_id) continue;
    if (!clientVisits[a.client_id]) clientVisits[a.client_id] = [];
    clientVisits[a.client_id].push(new Date(a.start_time));
  }
  let totalGap = 0;
  let gapCount = 0;
  for (const visits of Object.values(clientVisits)) {
    if (visits.length < 2) continue;
    visits.sort((a, b) => a.getTime() - b.getTime());
    for (let i = 1; i < visits.length; i++) {
      totalGap += (visits[i].getTime() - visits[i - 1].getTime()) / (1000 * 60 * 60 * 24);
      gapCount++;
    }
  }
  const avgReturnDays = gapCount > 0 ? Math.round(totalGap / gapCount) : null;

  // Channel breakdown
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
    month: {
      appointments: monthApps.length,
      clients: monthClientIds.size,
      revenue: monthlyRevenue,
      avgTicket,
    },
    year: {
      appointments: yearApps.length,
      clients: yearClientIds.size,
      revenue: yearlyRevenue,
    },
    avgReturnDays,
    channels: channelCounts,
  });
}
