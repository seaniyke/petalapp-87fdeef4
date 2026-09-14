-- 1. Internal economics configuration (never customer-facing)
CREATE TABLE public.economics_config (
  key TEXT PRIMARY KEY,
  value NUMERIC(14,6) NOT NULL,
  unit TEXT NOT NULL DEFAULT 'usd',
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.economics_config TO service_role;
ALTER TABLE public.economics_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage economics config"
  ON public.economics_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.economics_config (key, value, unit, description) VALUES
  ('target_variable_cost_per_credit_usd', 0.05, 'usd', 'Internal target variable-cost capacity represented by 1 Petal Credit'),
  ('build_minute_usd', 0.02, 'usd', 'Estimated builder compute cost per build minute'),
  ('verification_minute_usd', 0.02, 'usd', 'Estimated headless verification cost per minute'),
  ('deploy_event_usd', 0.002, 'usd', 'Estimated cost of one deploy'),
  ('image_generation_usd', 0.02, 'usd', 'Estimated provider cost of one generated image'),
  ('min_purchase_ngn', 5000, 'ngn', 'Minimum customer-facing credit purchase in NGN'),
  ('target_gross_margin_pct', 60, 'pct', 'Target gross margin over variable cost'),
  ('free_user_monthly_cost_ceiling_usd', 1.50, 'usd', 'Internal monthly variable-cost ceiling per free user before graceful degradation')
ON CONFLICT (key) DO NOTHING;

-- 2. Per-turn economics record
CREATE TABLE public.turn_economics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id TEXT NOT NULL UNIQUE,
  user_id UUID,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  build_id UUID,
  feature TEXT NOT NULL DEFAULT 'generate',
  credits_charged NUMERIC(10,2) NOT NULL DEFAULT 0,
  credits_refunded NUMERIC(10,2) NOT NULL DEFAULT 0,
  ai_calls INTEGER NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  cached_prompt_tokens BIGINT NOT NULL DEFAULT 0,
  models JSONB NOT NULL DEFAULT '[]'::jsonb,
  providers JSONB NOT NULL DEFAULT '[]'::jsonb,
  agent_rounds INTEGER NOT NULL DEFAULT 0,
  images_generated INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  build_ms BIGINT,
  verify_ms BIGINT,
  deploy_ms BIGINT,
  ai_cost_usd_micro BIGINT,
  build_cost_usd_micro BIGINT,
  other_cost_usd_micro BIGINT,
  variable_cost_usd_micro BIGINT,
  cost_basis TEXT NOT NULL DEFAULT 'unknown',
  result TEXT,
  is_auto_fix BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.turn_economics TO authenticated;
GRANT ALL ON public.turn_economics TO service_role;
ALTER TABLE public.turn_economics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners read own turn economics"
  ON public.turn_economics FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_turn_economics_created_at ON public.turn_economics (created_at DESC);
CREATE INDEX idx_turn_economics_user ON public.turn_economics (user_id, created_at DESC);
CREATE INDEX idx_turn_economics_project ON public.turn_economics (project_id, created_at DESC);

CREATE TRIGGER turn_economics_set_updated_at
  BEFORE UPDATE ON public.turn_economics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Cost confidence on the existing AI call log (additive only)
ALTER TABLE public.ai_call_log
  ADD COLUMN IF NOT EXISTS cost_basis TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS cost_source TEXT,
  ADD COLUMN IF NOT EXISTS turn_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_call_log_turn ON public.ai_call_log (turn_id);
