-- 1) Runtime error ingest (used by /api/public/track-runtime-error)
CREATE TABLE public.petal_runtime_errors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  build_id UUID NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT NULL,
  source TEXT NULL,
  lineno INTEGER NULL,
  colno INTEGER NULL,
  user_agent TEXT NULL,
  page_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_petal_runtime_errors_project_created
  ON public.petal_runtime_errors (project_id, created_at DESC);

GRANT SELECT ON public.petal_runtime_errors TO authenticated;
GRANT ALL ON public.petal_runtime_errors TO service_role;

ALTER TABLE public.petal_runtime_errors ENABLE ROW LEVEL SECURITY;

-- Owners can read their own project's runtime errors
CREATE POLICY "Owners read their runtime errors"
  ON public.petal_runtime_errors
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = petal_runtime_errors.project_id
        AND p.owner_id = auth.uid()
    )
  );

-- 2) Builder retry counter
ALTER TABLE public.project_builds
  ADD COLUMN IF NOT EXISTS retry_count SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ NULL;