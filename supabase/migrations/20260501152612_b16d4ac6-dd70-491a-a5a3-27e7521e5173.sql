-- Tracks which supabase/migrations/*.sql files Petal has actually applied
-- against each project's managed Supabase backend. Append-only history.
CREATE TABLE public.project_backend_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  migration_path text NOT NULL,
  content_hash text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_status text NOT NULL CHECK (applied_status IN ('success','failed')),
  error_message text,
  UNIQUE (project_id, migration_path, content_hash)
);

CREATE INDEX idx_pbm_project_applied ON public.project_backend_migrations(project_id, applied_at DESC);

ALTER TABLE public.project_backend_migrations ENABLE ROW LEVEL SECURITY;

-- Owners can read their own migration history. Writes are server-only
-- (service role bypasses RLS), so we don't need INSERT/UPDATE/DELETE policies.
CREATE POLICY "Owners read their migration history"
  ON public.project_backend_migrations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Admins read all migration history"
  ON public.project_backend_migrations
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));