ALTER TABLE public.ai_call_log ADD COLUMN IF NOT EXISTS key_owner TEXT NOT NULL DEFAULT 'platform';

CREATE INDEX IF NOT EXISTS ai_call_log_turn_idx ON public.ai_call_log (turn_id) WHERE turn_id IS NOT NULL;

CREATE OR REPLACE VIEW public.ai_turn_economics_rollup
WITH (security_invoker = true)
AS
SELECT
  l.turn_id,
  min(l.created_at)                                              AS started_at,
  max(l.user_id::text)                                           AS user_id,
  max(l.project_id::text)                                        AS project_id,
  count(*)                                                       AS ai_calls,
  count(*) FILTER (WHERE l.fallback_used)                        AS retries,
  count(*) FILTER (WHERE l.status >= 400)                        AS errors,
  count(*) FILTER (WHERE l.prompt_tokens IS NULL)                AS calls_without_usage,
  sum(l.prompt_tokens)                                           AS input_tokens,
  sum(l.completion_tokens)                                       AS output_tokens,
  sum(l.total_tokens)                                            AS total_tokens,
  sum(l.cached_prompt_tokens)                                    AS cached_input_tokens,
  sum(l.cost_usd_micro)::numeric / 1000000                       AS cost_usd
FROM public.ai_call_log l
WHERE l.turn_id IS NOT NULL
GROUP BY l.turn_id;

GRANT SELECT ON public.ai_turn_economics_rollup TO service_role;