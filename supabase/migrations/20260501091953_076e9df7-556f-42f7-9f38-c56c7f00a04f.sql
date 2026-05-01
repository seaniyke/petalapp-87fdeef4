-- One row per UTC day. The cron job upserts on period_date so reruns are idempotent.
CREATE TABLE public.petal_self_learning_digests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_date DATE NOT NULL UNIQUE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- High-level counters (last 24h ending at generated_at)
  total_turns INTEGER NOT NULL DEFAULT 0,
  total_projects INTEGER NOT NULL DEFAULT 0,
  total_users INTEGER NOT NULL DEFAULT 0,
  verifier_pass_rate NUMERIC(5,4),
  build_success_rate NUMERIC(5,4),
  followup_was_fix_rate NUMERIC(5,4),
  avg_autofix_count NUMERIC(6,2),

  -- Aggregated insights (JSON arrays for flexible rendering)
  top_failure_signatures JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_reverted_prompts JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Full raw payload (everything the email rendered from)
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Email delivery tracking
  email_sent_at TIMESTAMPTZ,
  email_recipients TEXT[],
  email_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_petal_self_learning_digests_period_date
  ON public.petal_self_learning_digests (period_date DESC);

ALTER TABLE public.petal_self_learning_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read self-learning digests"
  ON public.petal_self_learning_digests
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Service role can insert self-learning digests"
  ON public.petal_self_learning_digests
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update self-learning digests"
  ON public.petal_self_learning_digests
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_petal_self_learning_digests_updated_at
  BEFORE UPDATE ON public.petal_self_learning_digests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();