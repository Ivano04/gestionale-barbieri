import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from '@/services/treatwell-sync/client';
import { pollTreatwell } from '@/services/treatwell-sync/poller';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: salons } = await supabase
    .from('salons')
    .select('id, treatwell_salon_id, treatwell_api_enabled')
    .eq('treatwell_api_enabled', true);

  if (!salons?.length) {
    return Response.json({ message: 'No active Treatwell salons' });
  }

  const results: { salon_id: string; status: string }[] = [];
  for (const salon of salons) {
    const client = new TreatwellClient({
      baseUrl: process.env.TREATWELL_API_BASE_URL!,
      salonId: salon.treatwell_salon_id!,
    });
    await pollTreatwell(salon.id, client);
    results.push({ salon_id: salon.id, status: 'polled' });
  }

  return Response.json({ results });
}
