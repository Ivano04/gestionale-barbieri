-- Migration 006: drop waitlist + notifications (unused features)

-- 1. Drop notifications table (depends on waitlist_entries via FK)
DROP TABLE IF EXISTS public.notifications CASCADE;

-- 2. Drop waitlist_entries table
DROP TABLE IF EXISTS public.waitlist_entries CASCADE;

-- 3. Remove notification_preference column from clients (never used in UI)
ALTER TABLE public.clients DROP COLUMN IF EXISTS notification_preference;
