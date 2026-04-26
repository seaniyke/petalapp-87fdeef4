-- Project version snapshots
CREATE TABLE public.project_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label TEXT,
  summary TEXT,
  files JSONB NOT NULL,
  origin TEXT NOT NULL DEFAULT 'auto',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_versions_project_created
  ON public.project_versions(project_id, created_at DESC);

ALTER TABLE public.project_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view project versions"
  ON public.project_versions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_versions.project_id
      AND p.owner_id = auth.uid()
  ));

CREATE POLICY "Anyone can view versions of public projects"
  ON public.project_versions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_versions.project_id
      AND p.is_public = true
  ));

CREATE POLICY "Owners can insert project versions"
  ON public.project_versions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_versions.project_id
      AND p.owner_id = auth.uid()
  ));

CREATE POLICY "Owners can delete project versions"
  ON public.project_versions FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_versions.project_id
      AND p.owner_id = auth.uid()
  ));

-- Auto-prune: keep newest 50 auto snapshots per project
CREATE OR REPLACE FUNCTION public.prune_project_versions()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.project_versions
  WHERE project_id = NEW.project_id
    AND origin = 'auto'
    AND id NOT IN (
      SELECT id FROM public.project_versions
      WHERE project_id = NEW.project_id
        AND origin = 'auto'
      ORDER BY created_at DESC
      LIMIT 50
    );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_prune_project_versions
AFTER INSERT ON public.project_versions
FOR EACH ROW
EXECUTE FUNCTION public.prune_project_versions();