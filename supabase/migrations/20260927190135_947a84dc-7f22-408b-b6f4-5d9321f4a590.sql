INSERT INTO public.economics_config (key, value, unit, description) VALUES
 ('effort_curve_a', 0.38, 'credits', 'Effort price curve: credits = a × effort^p'),
 ('effort_curve_p', 0.9, 'exponent', 'Effort price curve exponent'),
 ('effort_margin_floor_pct', 70, 'pct', 'Builds below this margin are flagged (never repriced)'),
 ('effort_estimate_error', 0.5, 'ratio', 'Estimate error above this is flagged as bad_estimate'),
 ('effort_w_base', 0.5, 'effort', 'Effort: fixed per request'),
 ('effort_w_fileCreated', 1, 'effort', 'Effort per new file'),
 ('effort_w_fileModified', 0.6, 'effort', 'Effort per edited file'),
 ('effort_w_fileDeleted', 0.2, 'effort', 'Effort per deleted file'),
 ('effort_w_perLine', 0.004, 'effort', 'Effort per changed line'),
 ('effort_w_lineCapPerFile', 300, 'lines', 'Lines counted per file at most'),
 ('effort_w_page', 1.5, 'effort', 'Effort per page created/changed'),
 ('effort_w_capability', 2, 'effort', 'Effort per backend/integration capability'),
 ('effort_w_validation', 0.2, 'effort', 'Effort per passing verification'),
 ('effort_w_validationCap', 10, 'count', 'Verifications counted at most'),
 ('effort_w_perMinute', 0.1, 'effort', 'Effort per minute of wall time'),
 ('effort_w_minuteCap', 1, 'effort', 'Maximum effort from time'),
 ('effort_class_simple', 1, 'effort', 'Default expected effort SIMPLE'),
 ('effort_class_light', 2, 'effort', 'Default expected effort LIGHT'),
 ('effort_class_standard', 8, 'effort', 'Default expected effort STANDARD'),
 ('effort_class_heavy', 14, 'effort', 'Default expected effort HEAVY'),
 ('effort_class_complex', 24, 'effort', 'Default expected effort COMPLEX'),
 ('effort_class_escalated', 30, 'effort', 'Default expected effort ESCALATED')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.billing_class_effort_p75(_class text)
RETURNS TABLE(samples integer, p75 numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY (metadata->'effort'->>'score')::numeric)::numeric
  FROM public.turn_economics
  WHERE metadata->'effort'->>'class' = _class
    AND metadata->'effort'->>'score' IS NOT NULL
    AND credits_charged > 0
    AND created_at > now() - interval '90 days';
$$;
REVOKE ALL ON FUNCTION public.billing_class_effort_p75(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_class_effort_p75(text) TO service_role;

CREATE OR REPLACE FUNCTION public.effort_economics_summary(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (
    SELECT coalesce(metadata->'effort'->>'class','UNKNOWN') AS cls,
           coalesce(metadata->>'model','unknown') AS model,
           credits_charged::numeric AS credits,
           (metadata->'effort'->>'score')::numeric AS effort,
           (metadata->'effort'->>'estimated_effort')::numeric AS est_effort,
           (metadata->'profitability'->>'revenueUsd')::numeric AS revenue,
           (metadata->'profitability'->>'costUsd')::numeric AS cost,
           (metadata->'profitability'->>'wastedCostUsd')::numeric AS wasted,
           (metadata->'profitability'->>'marginPct')::numeric AS margin,
           metadata->'economic_flags' AS flags
    FROM public.turn_economics
    WHERE created_at > now() - make_interval(days => _days)
      AND metadata ? 'profitability' AND metadata->'profitability' <> 'null'::jsonb
  ), g AS (
    SELECT 'class' AS dim, cls AS key, * FROM t
    UNION ALL SELECT 'model', model, * FROM t
    UNION ALL SELECT 'all', 'all', * FROM t
  )
  SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
    SELECT dim, key, count(*) AS builds,
      round(sum(credits),2) AS credits, round(sum(revenue),4) AS revenue_usd,
      round(avg(credits),2) AS avg_credits,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY credits)::numeric,2) AS median_credits,
      round(sum(cost),5) AS cost_usd, round(sum(wasted),5) AS wasted_usd,
      round(sum(cost)-sum(wasted),5) AS productive_usd,
      round(sum(revenue)-sum(cost),4) AS contribution_usd,
      CASE WHEN sum(revenue)>0 THEN round((sum(revenue)-sum(cost))/sum(revenue)*100,1) END AS margin_pct,
      CASE WHEN sum(cost)>0 THEN round(sum(revenue)/sum(cost),1) END AS markup,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY effort)::numeric,2) AS p50_effort,
      round(percentile_cont(0.75) WITHIN GROUP (ORDER BY effort)::numeric,2) AS p75_effort,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY effort)::numeric,2) AS p90_effort,
      round(avg(abs(effort-est_effort)/nullif(est_effort,0))::numeric,2) AS avg_estimate_error,
      count(*) FILTER (WHERE flags ? 'underpriced') AS underpriced,
      count(*) FILTER (WHERE flags ? 'expensive_execution') AS expensive_execution,
      count(*) FILTER (WHERE flags ? 'bad_estimate') AS bad_estimate
    FROM g GROUP BY dim, key ORDER BY dim, key
  ) x;
$$;
REVOKE ALL ON FUNCTION public.effort_economics_summary(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effort_economics_summary(integer) TO service_role;