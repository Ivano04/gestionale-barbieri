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
  created_at: string;
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
  created_at: string;
}

export interface Client {
  id: string;
  salon_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  ghl_contact_id: string | null;
  treatwell_client_id: string | null;
  created_at: string;
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
  created_at: string;
  updated_at: string;
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
