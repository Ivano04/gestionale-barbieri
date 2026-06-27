-- Migration 008: stylist active/inactive flag
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
UPDATE public.users SET is_active = true WHERE is_active IS NULL;
