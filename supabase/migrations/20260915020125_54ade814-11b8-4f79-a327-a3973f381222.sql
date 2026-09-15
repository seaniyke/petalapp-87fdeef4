ALTER TABLE public.turns ADD COLUMN IF NOT EXISTS pending_memory jsonb;

CREATE INDEX IF NOT EXISTS idx_turns_pending_memory
  ON public.turns (started_at DESC)
  WHERE pending_memory IS NOT NULL;