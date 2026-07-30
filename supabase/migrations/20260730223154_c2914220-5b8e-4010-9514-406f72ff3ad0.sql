DROP POLICY IF EXISTS "Owners can create shares" ON public.preview_shares;
CREATE POLICY "Owners can create shares" ON public.preview_shares
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = preview_shares.project_id
      AND p.owner_id = auth.uid()
  )
);