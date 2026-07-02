import { createAdminClient } from '@/lib/supabase/admin';
import { TreatwellClient } from './client';

function getClient(): TreatwellClient {
  return new TreatwellClient({
    baseUrl: process.env.TREATWELL_API_BASE_URL || 'https://api.uala.it/api/v1',
    venueId: process.env.TREATWELL_VENUE_ID || '482',
    token: process.env.TREATWELL_API_TOKEN || '',
    clientAuth: process.env.TREATWELL_CLIENT_AUTH || '',
  });
}

// Legacy wrapper — now using pushToTreatwell from sync.ts instead
// This file kept for backward compatibility
export async function checkAndWriteTreatwell(): Promise<boolean> {
  return true;
}
