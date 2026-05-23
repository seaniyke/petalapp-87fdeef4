ALTER TABLE public.ai_call_log
  ADD COLUMN IF NOT EXISTS cached_prompt_tokens integer,
  ADD COLUMN IF NOT EXISTS static_prefix_chars integer,
  ADD COLUMN IF NOT EXISTS static_prefix_hash text,
  ADD COLUMN IF NOT EXISTS files_sent integer;

CREATE INDEX IF NOT EXISTS ai_call_log_prefix_hash_idx
  ON public.ai_call_log (static_prefix_hash, created_at DESC)
  WHERE static_prefix_hash IS NOT NULL;