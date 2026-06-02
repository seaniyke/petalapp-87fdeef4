ALTER TABLE public.ai_call_log
  ADD COLUMN IF NOT EXISTS project_id uuid NULL,
  ADD COLUMN IF NOT EXISTS user_id uuid NULL;

CREATE INDEX IF NOT EXISTS ai_call_log_project_created_idx
  ON public.ai_call_log (project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_call_log_user_created_idx
  ON public.ai_call_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;