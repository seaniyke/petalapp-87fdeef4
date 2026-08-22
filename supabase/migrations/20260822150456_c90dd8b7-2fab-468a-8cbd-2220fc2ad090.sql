CREATE TABLE IF NOT EXISTS public.project_intelligence (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_intelligence_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  turn_id TEXT,
  summary TEXT,
  context JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_intelligence_history_project
  ON public.project_intelligence_history(project_id, revision DESC);

GRANT SELECT ON public.project_intelligence TO authenticated;
GRANT ALL ON public.project_intelligence TO service_role;
GRANT SELECT ON public.project_intelligence_history TO authenticated;
GRANT ALL ON public.project_intelligence_history TO service_role;

ALTER TABLE public.project_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_intelligence_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view project intelligence" ON public.project_intelligence;
CREATE POLICY "Owners can view project intelligence"
  ON public.project_intelligence
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_intelligence.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can view project intelligence history" ON public.project_intelligence_history;
CREATE POLICY "Owners can view project intelligence history"
  ON public.project_intelligence_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_intelligence_history.project_id
        AND p.owner_id = auth.uid()
    )
  );