export type UserRole = 'owner' | 'admin' | 'stylist' | 'receptionist';
export type AppointmentStatus = 'confirmed' | 'cancelled' | 'no_show' | 'completed';
export type AppointmentSource = 'widget' | 'manual' | 'phone' | 'google' | 'treatwell' | 'walk_in' | 'whatsapp';
export type SyncDirection = 'treatwell→us' | 'us→treatwell' | 'us→ghl';
export type SyncStatus = 'success' | 'failed' | 'conflict' | 'pending_retry';

export interface Salon {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  open_time: string;
  close_time: string;
  working_hours: Record<string, { open: string; close: string } | null> | null;
  ghl_subaccount_id: string | null;
  treatwell_salon_id: string | null;
  treatwell_api_enabled: boolean;
  created_at: string;
}

export interface User {
  id: string;
  salon_id: string;
  email: string;
  role: UserRole;
  full_name: string;
  avatar_url: string | null;
  working_hours: Record<string, { open: string; close: string } | null> | null;
  created_at: string;
}

/** Breakdown of service duration into phases */
export interface PhaseBreakdown {
  application: number;
  processing: number;
  finishing: number;
  buffer: number;
  totalClientVisible: number;   // application + processing + finishing
  totalInternal: number;         // application + processing + finishing + buffer
}

export interface Service {
  id: string;
  salon_id: string;
  name: string;
  duration_minutes: number;
  price_cents: number;
  color_hex: string;
  is_active: boolean;
  treatwell_service_id: string | null;
  /** Phase decomposition (NULL = fallback to duration_minutes) */
  duration_application: number | null;
  duration_processing: number | null;
  duration_finishing: number | null;
  /** Invisible to clients, only for internal calendar */
  buffer_time_minutes: number;
  created_at: string;
}

export interface ServiceOverride {
  id: string;
  salon_id: string;
  service_id: string;
  stylist_id: string;
  duration_application: number | null;
  duration_processing: number | null;
  duration_finishing: number | null;
  buffer_time_minutes: number | null;
}

export interface Client {
  id: string;
  salon_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  notification_preference: 'sms' | 'email' | 'both' | 'none';
  ghl_contact_id: string | null;
  treatwell_client_id: string | null;
  created_at: string;
}

export interface AddedService {
  service_id: string;
  name: string;
  duration_added: number;
  added_at: string;
}

export interface Appointment {
  id: string;
  salon_id: string;
  client_id: string | null;
  stylist_id: string | null;
  service_id: string | null;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  treatwell_appointment_id: string | null;
  ghl_appointment_id: string | null;
  notes: string | null;
  /** end_time + buffer_time — used internally for stylist blocking */
  buffer_end_time: string | null;
  /** Services added mid-appointment (in-chair upselling) */
  added_services: AddedService[];
  created_at: string;
  updated_at: string;
  // Joined relations
  client?: Client;
  stylist?: User;
  service?: Service;
}

export interface TimeBlock {
  id: string;
  salon_id: string;
  stylist_id: string | null;
  start_time: string;
  end_time: string;
  reason: string | null;
}

export interface SyncLog {
  id: string;
  salon_id: string;
  direction: SyncDirection;
  appointment_id: string | null;
  status: SyncStatus;
  external_id: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
}

/** Overlap severity for conflict engine */
export type ConflictSeverity = 'none' | 'soft' | 'hard';

export interface ConflictResult {
  severity: ConflictSeverity;
  conflictingAppointment?: Appointment;
  conflictingStylistName?: string;
  /** If soft conflict, which phase overlaps */
  overlapPhase?: 'application' | 'processing' | 'finishing' | 'buffer';
}

/** Smart swap suggestion */
export interface SwapSuggestion {
  appointmentId: string;
  targetStylistId: string;
  targetStylistName: string;
  reason: string;
}

/** Waitlist */
export type WaitlistStatus = 'waiting' | 'notified' | 'booked' | 'expired' | 'cancelled';

export interface WaitlistEntry {
  id: string;
  salon_id: string;
  client_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  service_id: string;
  stylist_id: string | null;
  preferred_date: string;
  preferred_time_start: string | null;
  preferred_time_end: string | null;
  status: WaitlistStatus;
  notified_at: string | null;
  booked_appointment_id: string | null;
  created_at: string;
  expires_at: string;
  // Joined
  service?: Service;
  stylist?: Pick<User, 'id' | 'full_name'>;
}

/** Notification */
export type NotificationType =
  | 'appointment_confirmed'
  | 'appointment_reminder'
  | 'appointment_cancelled'
  | 'appointment_updated'
  | 'waitlist_slot_available';

export type NotificationChannel = 'sms' | 'email';

export interface Notification {
  id: string;
  salon_id: string;
  appointment_id: string | null;
  waitlist_entry_id: string | null;
  client_id: string | null;
  type: NotificationType;
  channel: NotificationChannel;
  recipient: string;
  status: 'pending' | 'sent' | 'failed';
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}
