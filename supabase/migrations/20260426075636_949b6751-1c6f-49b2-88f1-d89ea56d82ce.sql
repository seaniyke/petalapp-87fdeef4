-- Phase 7.2a: server-built, CDN-served previews
-- Adds a build pipeline table + storage bucket for compiled project artifacts.

-- 1) project_builds — one row per build attempt
CREATE TABLE public.project_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','building','ready','failed')),
  dist_path text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz
);

CREATE INDEX idx_project_builds_project_created
  ON public.project_builds(project_id, created_at DESC);

ALTER TABLE public.project_builds ENABLE ROW LEVEL SECURITY;

-- Owners or anyone (if project is public) can read build status.
-- Writes happen only via server functions using the service role key, so no
-- INSERT/UPDATE/DELETE policies are needed.
CREATE POLICY "Read own or public project builds"
  ON public.project_builds
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (p.owner_id = auth.uid() OR p.is_public = true)
    )
  );

-- 2) latest_build_id on projects for cheap lookup
ALTER TABLE public.projects
  ADD COLUMN latest_build_id uuid REFERENCES public.project_builds(id);

-- 3) Storage bucket for built artifacts. Private bucket — reads go through
-- our /preview/* server route, which checks RLS-equivalent auth before
-- streaming the file using the service role.
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-builds', 'project-builds', false)
ON CONFLICT (id) DO NOTHING;

-- No storage RLS policies needed: only the server (service role) reads/writes
-- this bucket. Clients never touch it directly.