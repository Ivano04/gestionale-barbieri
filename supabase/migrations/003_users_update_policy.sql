-- Migration: add UPDATE policy for users table (working hours, profile)

-- Owner/admin can update any user in their salon
CREATE POLICY "Staff update salon mates" ON public.users FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users AS u
      WHERE u.id = auth.uid()
        AND u.salon_id = users.salon_id
        AND u.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users AS u
      WHERE u.id = auth.uid()
        AND u.salon_id = users.salon_id
        AND u.role IN ('owner', 'admin')
    )
  );

-- Users can update their own row (e.g. change their own working hours)
CREATE POLICY "Users update own row" ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
