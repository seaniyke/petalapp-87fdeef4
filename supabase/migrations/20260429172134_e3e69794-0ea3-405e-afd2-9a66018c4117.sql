-- Phase 6 telemetry: per-tier per-turn events for the generate pipeline.
-- Lets us answer "how often does Tier 2.8 fire / fail", "p50/p95 latency
-- per tier", "top hallucinated packages last 7d", "how often does the
-- handoff chip fire and why".
--
-- Design notes:
--   * One row per tier per turn. `turn_id` groups them; `tier_order` keeps
--     the canonical pipeline order so dashboards don't have to hand-sort.
--   * `details` is jsonb so we can stash tier-specific extras (handoff
--     reason, hallucinated package list, structural/imports/soft breakdown,
--     truncated paths) without schema churn for every new tier.
--   * RLS: admins read, service role inserts. Mirrors `ai_call_outcomes`.

CREATE TABLE public.pipeline_tier_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL,
  project_id uuid,
  message_id uuid,
  model text,
  tier text NOT NULL,
  tier_order numeric NOT NULL,
  outcome text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  issue_count integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_tier_events_created_at
  ON public.pipeline_tier_events (created_at DESC);
CREATE INDEX idx_pipeline_tier_events_tier_created
  ON public.pipeline_tier_events (tier, created_at DESC);
CREATE INDEX idx_pipeline_tier_events_turn
  ON public.pipeline_tier_events (turn_id);
CREATE INDEX idx_pipeline_tier_events_project
  ON public.pipeline_tier_events (project_id, created_at DESC);

ALTER TABLE public.pipeline_tier_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read pipeline_tier_events"
  ON public.pipeline_tier_events
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can insert pipeline_tier_events"
  ON public.pipeline_tier_events
  FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role'::text);
