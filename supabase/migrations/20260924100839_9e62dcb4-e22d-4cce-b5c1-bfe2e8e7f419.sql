ALTER TABLE public.ai_call_log ADD COLUMN IF NOT EXISTS attempt_id uuid, ADD COLUMN IF NOT EXISTS attempt_state text;
CREATE INDEX IF NOT EXISTS ai_call_log_attempt_id_idx ON public.ai_call_log (attempt_id);
ALTER TABLE public.pipeline_tier_events ADD COLUMN IF NOT EXISTS attempt_id uuid;