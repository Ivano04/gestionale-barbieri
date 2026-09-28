import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationsRepo } from './service';
import type { NotificationType } from './types';

// Implementazione Supabase di NotificationsRepo (usare con l'admin client: scritture server-side).
export function createSupabaseNotificationsRepo(supabase: SupabaseClient): NotificationsRepo {
  return {
    async alreadySent(appointmentId: string, type: NotificationType): Promise<boolean> {
      const { data } = await supabase
        .from('notifications')
        .select('id')
        .eq('appointment_id', appointmentId)
        .eq('type', type)
        .maybeSingle();
      return !!data;
    },

    async markSent(row: { salon_id: string; appointment_id: string; type: NotificationType }): Promise<void> {
      // upsert idempotente: se la notifica esiste gia' (UNIQUE appointment_id,type) non duplica.
      await supabase
        .from('notifications')
        .upsert(
          { ...row, status: 'sent', sent_at: new Date().toISOString() },
          { onConflict: 'appointment_id,type', ignoreDuplicates: true },
        );
    },
  };
}
