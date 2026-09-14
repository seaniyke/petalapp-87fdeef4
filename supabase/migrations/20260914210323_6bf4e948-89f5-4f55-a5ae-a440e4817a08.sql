CREATE TABLE public.project_test_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  build_id UUID,
  turn_id UUID,
  status TEXT NOT NULL DEFAULT 'running',
  budget TEXT NOT NULL DEFAULT 'full',
  base_url TEXT,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  blocked_reason TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX project_test_runs_project_idx ON public.project_test_runs (project_id, created_at DESC);
CREATE INDEX project_test_runs_build_idx ON public.project_test_runs (build_id);

GRANT SELECT ON public.project_test_runs TO authenticated;
GRANT ALL ON public.project_test_runs TO service_role;

ALTER TABLE public.project_test_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their project test runs"
  ON public.project_test_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_test_runs.project_id AND p.owner_id = auth.uid()));

CREATE TRIGGER update_project_test_runs_updated_at
  BEFORE UPDATE ON public.project_test_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.project_test_cases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.project_test_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  case_key TEXT NOT NULL,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'P1',
  category TEXT NOT NULL DEFAULT 'load',
  status TEXT NOT NULL DEFAULT 'skipped',
  attempt INTEGER NOT NULL DEFAULT 1,
  expected TEXT,
  actual TEXT,
  reason TEXT,
  url TEXT,
  duration_ms INTEGER,
  console_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  page_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  failed_requests JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX project_test_cases_run_idx ON public.project_test_cases (run_id, priority, created_at);
CREATE INDEX project_test_cases_project_idx ON public.project_test_cases (project_id, created_at DESC);

GRANT SELECT ON public.project_test_cases TO authenticated;
GRANT ALL ON public.project_test_cases TO service_role;

ALTER TABLE public.project_test_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their project test cases"
  ON public.project_test_cases FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_test_cases.project_id AND p.owner_id = auth.uid()));