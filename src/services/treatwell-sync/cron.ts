import { createAdminClient } from '@/lib/supabase/admin';
import { pollTreatwell } from './poller';
import { TreatwellClient } from './client';

let running = false;

function getClient(): TreatwellClient {
  return new TreatwellClient({
    baseUrl: process.env.TREATWELL_API_BASE_URL || 'https://api.uala.it/api/v1',
    venueId: process.env.TREATWELL_VENUE_ID || '482',
    token: process.env.TREATWELL_API_TOKEN || '',
    clientAuth: process.env.TREATWELL_CLIENT_AUTH || '',
  });
}

async function runPoll() {
  if (running) return;
  running = true;

  try {
    const supabase = createAdminClient();
    const { data: salons } = await supabase
      .from('salons')
      .select('id, treatwell_api_enabled')
      .eq('treatwell_api_enabled', true);

    if (!salons?.length) return;

    const client = getClient();
    for (const salon of salons) {
      await pollTreatwell(salon.id, client);
    }
  } catch (e: any) {
    console.error('[treatwell-cron] poll error:', e.message);
  } finally {
    running = false;
  }
}

/** Start the periodic Treatwell sync (called once at server startup) */
export function startTreatwellCron() {
  if (!process.env.TREATWELL_API_TOKEN) return;

  // Run first poll after 30 seconds
  setTimeout(runPoll, 30_000);

  // Then poll every 15 minutes
  setInterval(runPoll, 15 * 60 * 1000);
}
