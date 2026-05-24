import { createAdminClient } from '@/lib/supabase/admin';
import type { WaitlistEntry } from '@/lib/types';

export interface FreedSlot {
  salon_id: string;
  stylist_id: string | null;
  service_id: string | null;
  date: string;        // yyyy-MM-dd
  start_time: string;  // ISO
  end_time: string;    // ISO
}

/**
 * When an appointment is cancelled or moved, check the waitlist for matching entries.
 * Returns entries that match the freed slot (same service, same or any stylist, same date).
 * Marks them as 'notified' so the caller can trigger SMS/email via n8n.
 */
export async function matchWaitlist(freedSlot: FreedSlot): Promise<WaitlistEntry[]> {
  const supabase = createAdminClient();

  const date = freedSlot.date;

  // Find waitlist entries that match:
  // - Same salon
  // - Same service (or any)
  // - Same stylist (or no preference)
  // - Same date
  // - Status = 'waiting'
  // - Not expired
  const { data: entries } = await supabase
    .from('waitlist_entries')
    .select('*, service:services(*), stylist:users(id, full_name)')
    .eq('salon_id', freedSlot.salon_id)
    .eq('preferred_date', date)
    .eq('status', 'waiting')
    .gte('expires_at', new Date().toISOString())
    .or(
      `stylist_id.is.null${freedSlot.stylist_id ? `,stylist_id.eq.${freedSlot.stylist_id}` : ''}`,
    )
    .order('created_at', { ascending: true });

  if (!entries?.length) return [];

  // Filter by service match (if freed slot has a specific service)
  // Waitlist entries match if they want the same service or have no service preference
  const matching = freedSlot.service_id
    ? entries.filter(e => e.service_id === freedSlot.service_id)
    : entries;

  if (!matching.length) return [];

  // Mark all matching entries as notified
  const now = new Date().toISOString();
  const ids = matching.map(e => e.id);

  await supabase
    .from('waitlist_entries')
    .update({ status: 'notified', notified_at: now })
    .in('id', ids);

  // Log notifications
  const notificationRows = matching.map(e => ({
    salon_id: freedSlot.salon_id,
    waitlist_entry_id: e.id,
    client_id: e.client_id,
    type: 'waitlist_slot_available' as const,
    channel: 'sms' as const,
    recipient: e.phone || '',
    status: 'pending' as const,
  }));

  await supabase.from('notifications').insert(notificationRows);

  return matching as WaitlistEntry[];
}

/**
 * Get all active waitlist entries for a salon (dashboard view).
 */
export async function getWaitlistEntries(salonId: string): Promise<WaitlistEntry[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('waitlist_entries')
    .select('*, service:services(*), stylist:users(id, full_name)')
    .eq('salon_id', salonId)
    .eq('status', 'waiting')
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true });
  return (data || []) as WaitlistEntry[];
}
