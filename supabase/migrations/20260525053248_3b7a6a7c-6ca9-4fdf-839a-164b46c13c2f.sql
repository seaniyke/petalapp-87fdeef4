CREATE TABLE IF NOT EXISTS public.project_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  project_type TEXT NOT NULL DEFAULT 'app',
  sections TEXT[] NOT NULL DEFAULT '{}',
  navigation TEXT[] NOT NULL DEFAULT '{}',
  design_language TEXT,
  backend TEXT,
  files TEXT[] NOT NULL DEFAULT '{}',
  blueprint JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_blueprints_project_id
  ON public.project_blueprints(project_id);

ALTER TABLE public.project_blueprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view project blueprints" ON public.project_blueprints;
CREATE POLICY "Owners can view project blueprints"
  ON public.project_blueprints
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_blueprints.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Public project blueprints are viewable" ON public.project_blueprints;
CREATE POLICY "Public project blueprints are viewable"
  ON public.project_blueprints
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_blueprints.project_id
        AND p.is_public = true
    )
  );

DROP POLICY IF EXISTS "Owners can create project blueprints" ON public.project_blueprints;
CREATE POLICY "Owners can create project blueprints"
  ON public.project_blueprints
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_blueprints.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can update project blueprints" ON public.project_blueprints;
CREATE POLICY "Owners can update project blueprints"
  ON public.project_blueprints
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_blueprints.project_id
        AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_blueprints.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can delete project blueprints" ON public.project_blueprints;
CREATE POLICY "Owners can delete project blueprints"
  ON public.project_blueprints
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_blueprints.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS update_project_blueprints_updated_at ON public.project_blueprints;
CREATE TRIGGER update_project_blueprints_updated_at
  BEFORE UPDATE ON public.project_blueprints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();