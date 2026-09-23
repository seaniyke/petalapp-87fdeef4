ALTER TABLE public.ai_call_log
  ADD COLUMN IF NOT EXISTS cache_write_tokens integer,
  ADD COLUMN IF NOT EXISTS reasoning_tokens integer,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS upstream_provider text;