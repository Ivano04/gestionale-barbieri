-- Migration 009: unique constraint su treatwell_appointment_id
-- Previene duplicati da race condition push→poll

-- Rimuovi duplicati esistenti (tieni il primo per ogni treatwell_appointment_id)
DELETE FROM public.appointments a
WHERE a.id NOT IN (
  SELECT MIN(id) FROM public.appointments
  WHERE treatwell_appointment_id IS NOT NULL
  GROUP BY treatwell_appointment_id
)
AND a.treatwell_appointment_id IS NOT NULL;

-- Aggiungi unique index (solo per righe con treatwell_appointment_id valorizzato)
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_treatwell_id
  ON public.appointments (treatwell_appointment_id)
  WHERE treatwell_appointment_id IS NOT NULL;
