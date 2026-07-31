ALTER TABLE public.projects ALTER COLUMN is_public SET DEFAULT false;

DROP POLICY IF EXISTS "Anyone can view public projects" ON public.projects;
CREATE POLICY "Anyone can view published public projects"
ON public.projects
FOR SELECT
USING (is_public = true AND published_visibility = 'public');

REVOKE SELECT (password_hash) ON public.shared_app_users FROM authenticated;
REVOKE SELECT (password_hash) ON public.shared_app_users FROM anon;
GRANT ALL ON public.shared_app_users TO service_role;