import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationsRepo } from './service';
import type { NotificationType } from './types';

// Implementazione Supabase di NotificationsRepo (usare con l'admin client: scritture server-side).
export function createSupabaseNotificationsRepo(supabase: SupabaseClient): NotificationsRepo {
  return {
    async isCurrent(id: string, start: string): Promise<boolean> {
      const { data, error } = await supabase.from('appointments').select('id').eq('id', id).eq('start_time', start).neq('status', 'cancelled').maybeSingle();
      if (error) throw new Error('Notification appointment check failed');
      return !!data;
    },
    async alreadySent(appointmentId: string, type: NotificationType): Promise<boolean> {
      const { data } = await supabase
        .from('notifications')
        .select('id')
        .eq('appointment_id', appointmentId)
        .eq('type', type)
        .maybeSingle();
      return !!data;
    },

    async markSent(row: { salon_id: string; appointment_id: string; type: NotificationType; expectedStart?: string }): Promise<void> {
      if (row.expectedStart) {
        const { error } = await supabase.rpc('mark_notification_for_current_start', { p_id: row.appointment_id, p_type: row.type, p_start: row.expectedStart });
        if (error) throw new Error('Notification checkpoint failed');
        return;
      }
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
