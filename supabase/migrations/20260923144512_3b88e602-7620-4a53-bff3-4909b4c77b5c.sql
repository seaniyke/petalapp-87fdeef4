ALTER TABLE public.benchmark_cases
  ADD COLUMN IF NOT EXISTS classification text,
  ADD COLUMN IF NOT EXISTS telemetry jsonb NOT NULL DEFAULT '{}'::jsonb;