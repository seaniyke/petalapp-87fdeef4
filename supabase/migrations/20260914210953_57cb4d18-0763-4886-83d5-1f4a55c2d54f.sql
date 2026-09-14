ALTER TABLE public.project_turn_completion
  ADD COLUMN IF NOT EXISTS verdict TEXT,
  ADD COLUMN IF NOT EXISTS readiness JSONB NOT NULL DEFAULT '{}'::jsonb;