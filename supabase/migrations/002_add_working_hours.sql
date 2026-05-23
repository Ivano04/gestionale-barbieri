-- Migration: add working_hours column to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS working_hours jsonb DEFAULT NULL;
