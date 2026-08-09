CREATE TABLE public.benchmark_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  trigger text NOT NULL DEFAULT 'cron',
  total_cases integer NOT NULL DEFAULT 0,
  completed_cases integer NOT NULL DEFAULT 0,
  build_completion numeric,
  functional_correctness numeric,
  spec_adherence numeric,
  visual_quality numeric,
  regression_safety numeric,
  overall_score numeric,
  regressions jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text
);

CREATE TABLE public.benchmark_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.benchmark_runs(id) ON DELETE CASCADE,
  case_id text NOT NULL,
  title text NOT NULL,
  prompt text NOT NULL,
  project_id uuid,
  build_id uuid,
  status text NOT NULL DEFAULT 'running',
  build_completed boolean NOT NULL DEFAULT false,
  functional_correctness numeric,
  spec_adherence numeric,
  visual_quality numeric,
  regression_safety numeric,
  criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  defects jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, case_id)
);

CREATE INDEX benchmark_cases_case_idx ON public.benchmark_cases (case_id, created_at DESC);

GRANT SELECT ON public.benchmark_runs TO authenticated;
GRANT SELECT ON public.benchmark_cases TO authenticated;
GRANT ALL ON public.benchmark_runs TO service_role;
GRANT ALL ON public.benchmark_cases TO service_role;

ALTER TABLE public.benchmark_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benchmark_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read benchmark runs" ON public.benchmark_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can read benchmark cases" ON public.benchmark_cases
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));