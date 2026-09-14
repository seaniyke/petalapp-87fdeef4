CREATE TABLE public.project_turn_completion (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  turn_id UUID NOT NULL,
  user_id UUID NOT NULL,
  stage TEXT NOT NULL DEFAULT 'generating',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  outstanding_defects JSONB NOT NULL DEFAULT '[]'::jsonb,
  defect_fingerprint TEXT,
  last_build_id UUID,
  accepted BOOLEAN NOT NULL DEFAULT false,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  terminal_reason TEXT,
  resume_after TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (turn_id)
);

CREATE INDEX project_turn_completion_project_idx
  ON public.project_turn_completion (project_id, created_at DESC);

CREATE INDEX project_turn_completion_open_idx
  ON public.project_turn_completion (stage, updated_at)
  WHERE stage NOT IN ('delivered', 'blocked', 'budget_spent', 'abandoned');

GRANT SELECT ON public.project_turn_completion TO authenticated;
GRANT ALL ON public.project_turn_completion TO service_role;

ALTER TABLE public.project_turn_completion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their project completion records"
  ON public.project_turn_completion
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_turn_completion.project_id
        AND p.owner_id = auth.uid()
    )
  );

CREATE TRIGGER update_project_turn_completion_updated_at
  BEFORE UPDATE ON public.project_turn_completion
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();