ALTER TABLE public.ai_call_log
  ADD COLUMN IF NOT EXISTS first_token_ms integer,
  ADD COLUMN IF NOT EXISTS last_token_ms integer,
  ADD COLUMN IF NOT EXISTS stream_total_ms integer,
  ADD COLUMN IF NOT EXISTS finish_reason text,
  ADD COLUMN IF NOT EXISTS stream_outcome text,
  ADD COLUMN IF NOT EXISTS stall_ms integer,
  ADD COLUMN IF NOT EXISTS fallback_number integer,
  ADD COLUMN IF NOT EXISTS fallback_from_upstream text,
  ADD COLUMN IF NOT EXISTS recovery_reason text;