DROP POLICY IF EXISTS "users update own plans" ON public.petal_plans;
CREATE POLICY "users update own plans" ON public.petal_plans
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners can update their shares" ON public.preview_shares;
CREATE POLICY "Owners can update their shares" ON public.preview_shares
FOR UPDATE USING (created_by = auth.uid())
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = preview_shares.project_id AND p.owner_id = auth.uid())
);

DROP POLICY IF EXISTS "Owners can update their backend" ON public.project_backends;
CREATE POLICY "Owners can update their backend" ON public.project_backends
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_backends.project_id AND p.owner_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_backends.project_id AND p.owner_id = auth.uid())
);

DROP POLICY IF EXISTS "Owners can update project files" ON public.project_files;
CREATE POLICY "Owners can update project files" ON public.project_files
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_files.project_id AND p.owner_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_files.project_id AND p.owner_id = auth.uid())
);