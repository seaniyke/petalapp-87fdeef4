ALTER TABLE public.tool_loop_calls
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS request_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_token_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS uncached_tokens int,
  ADD COLUMN IF NOT EXISTS knowledge_chars int,
  ADD COLUMN IF NOT EXISTS files_read text[],
  ADD COLUMN IF NOT EXISTS read_misses int,
  ADD COLUMN IF NOT EXISTS validation_failures int,
  ADD COLUMN IF NOT EXISTS tool_errors int,
  ADD COLUMN IF NOT EXISTS recovery text,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS call_class text;
GRANT ALL ON public.tool_loop_calls TO service_role;