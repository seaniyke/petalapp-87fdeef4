-- Tier 4 — telemetry-driven router.
-- Enrich ai_call_log with phase + prompt size so the router can score
-- per-(feature, phase) instead of just per-feature. Add an admin
-- kill-switch table so we can toggle the smart router off without code.

ALTER TABLE public.ai_call_log
  ADD COLUMN IF NOT EXISTS phase TEXT,
  ADD COLUMN IF NOT EXISTS prompt_chars INTEGER,
  ADD COLUMN IF NOT EXISTS had_attachments BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chosen_by TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_call_log_router
  ON public.ai_call_log (feature, phase, model, created_at DESC);

-- Single-row config table for the smart router.
CREATE TABLE IF NOT EXISTS public.ai_router_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT true,
  exploration_pct INTEGER NOT NULL DEFAULT 10,
  min_samples INTEGER NOT NULL DEFAULT 20,
  window_hours INTEGER NOT NULL DEFAULT 168,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID,
  CONSTRAINT ai_router_config_singleton CHECK (id = 1)
);

INSERT INTO public.ai_router_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ai_router_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read router config" ON public.ai_router_config;
CREATE POLICY "Admins can read router config"
ON public.ai_router_config
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can update router config" ON public.ai_router_config;
CREATE POLICY "Admins can update router config"
ON public.ai_router_config
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));