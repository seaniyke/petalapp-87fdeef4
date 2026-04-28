-- 1. Extend ai_provider_settings with per-feature model + fallback model
ALTER TABLE public.ai_provider_settings
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS fallback_model text;

-- 2. AI call log for the admin cost dashboard
CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  feature      text NOT NULL,
  provider     text NOT NULL,
  model        text,
  status       integer NOT NULL,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  cost_usd_micro bigint,           -- cost in millionths of a USD (1e-6) for accurate aggregation
  latency_ms   integer,
  fallback_used boolean NOT NULL DEFAULT false,
  error_message text
);

CREATE INDEX IF NOT EXISTS ai_call_log_feature_created_idx
  ON public.ai_call_log (feature, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_call_log_created_idx
  ON public.ai_call_log (created_at DESC);

ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read ai_call_log"
  ON public.ai_call_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Service role can insert ai_call_log"
  ON public.ai_call_log
  FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');
