
-- 1) Split project_backends.service_role_key into a service-role-only table.
CREATE TABLE IF NOT EXISTS public.project_backend_secrets (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  service_role_key TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only service_role may touch this table. No grants to anon/authenticated.
REVOKE ALL ON public.project_backend_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.project_backend_secrets TO service_role;

ALTER TABLE public.project_backend_secrets ENABLE ROW LEVEL SECURITY;
-- No policies == no client access even if grants slipped in later.

-- Backfill existing service role keys.
INSERT INTO public.project_backend_secrets (project_id, service_role_key)
SELECT project_id, service_role_key
FROM public.project_backends
WHERE service_role_key IS NOT NULL
ON CONFLICT (project_id) DO UPDATE
  SET service_role_key = EXCLUDED.service_role_key,
      updated_at = now();

-- Drop the column from project_backends so it can never be returned to clients.
ALTER TABLE public.project_backends DROP COLUMN IF EXISTS service_role_key;

-- 2) Restrict writes to the public petal-images bucket to authenticated users
--    on paths they own. Previously any anon/authenticated user could write to
--    any non-'project-builds' bucket.

DROP POLICY IF EXISTS "project-builds service-role only insert" ON storage.objects;
DROP POLICY IF EXISTS "project-builds service-role only update" ON storage.objects;
DROP POLICY IF EXISTS "project-builds service-role only delete" ON storage.objects;

-- Re-add narrow policies: writes on any non-'project-builds' bucket require
-- authentication AND path scoping. For petal-images the client-side upload
-- flow stores objects under `site/<project_id>/...`, so only the project
-- owner may write there. Other public buckets fall back to service_role only.

CREATE POLICY "petal-images owner upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'petal-images'
    AND (storage.foldername(name))[1] = 'site'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "petal-images owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'petal-images'
    AND (storage.foldername(name))[1] = 'site'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "petal-images owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'petal-images'
    AND (storage.foldername(name))[1] = 'site'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.owner_id = auth.uid()
    )
  );
