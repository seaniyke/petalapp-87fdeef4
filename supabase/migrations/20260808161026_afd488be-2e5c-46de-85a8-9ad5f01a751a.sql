-- 1) crypto_payments: restrictive owner-scoped guard that no future permissive policy can widen.
DROP POLICY IF EXISTS "Crypto payments are always owner scoped" ON public.crypto_payments;
CREATE POLICY "Crypto payments are always owner scoped"
  ON public.crypto_payments
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2) project_builds: only truly published projects are publicly readable.
DROP POLICY IF EXISTS "Read own or public project builds" ON public.project_builds;
DROP POLICY IF EXISTS "Owners and admins read their project builds" ON public.project_builds;
DROP POLICY IF EXISTS "Published project builds are readable" ON public.project_builds;

CREATE POLICY "Owners and admins read their project builds"
  ON public.project_builds
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_builds.project_id
        AND (p.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
    )
  );

CREATE POLICY "Published project builds are readable"
  ON public.project_builds
  FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_builds.project_id
        AND p.is_public = true
        AND p.published_visibility = 'public'
    )
  );

-- 3) Never expose internal error text / verification payloads to anonymous readers.
REVOKE SELECT ON public.project_builds FROM anon;
GRANT SELECT (id, project_id, status, dist_path, created_at, ready_at, retry_count, last_retry_at)
  ON public.project_builds TO anon;
GRANT SELECT ON public.project_builds TO authenticated;
GRANT ALL ON public.project_builds TO service_role;