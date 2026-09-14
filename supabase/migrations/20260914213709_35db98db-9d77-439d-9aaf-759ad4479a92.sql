CREATE TABLE public.project_edit_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  turn_id TEXT,
  build_id UUID,
  user_request TEXT NOT NULL DEFAULT '',
  change_set JSONB NOT NULL DEFAULT '[]'::jsonb,
  preserve JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  audit JSONB NOT NULL DEFAULT '{}'::jsonb,
  focus JSONB,
  complete BOOLEAN NOT NULL DEFAULT true,
  revert_to JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX project_edit_history_project_created_idx
  ON public.project_edit_history (project_id, created_at DESC);

GRANT SELECT ON public.project_edit_history TO authenticated;
GRANT ALL ON public.project_edit_history TO service_role;

ALTER TABLE public.project_edit_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their project edit history"
  ON public.project_edit_history
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_edit_history.project_id
      AND p.owner_id = auth.uid()
  ));

CREATE TRIGGER update_project_edit_history_updated_at
  BEFORE UPDATE ON public.project_edit_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();