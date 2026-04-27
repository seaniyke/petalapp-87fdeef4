DROP VIEW IF EXISTS public.v_build_costs;

CREATE VIEW public.v_build_costs
WITH (security_invoker = true)
AS
SELECT
  project_id,
  user_id,
  COUNT(*)                                   AS entries,
  SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS gross_spent,
  SUM(CASE WHEN delta > 0 THEN  delta ELSE 0 END) AS refunded,
  SUM(-delta)                                AS net_spent,
  MIN(created_at)                            AS first_at,
  MAX(created_at)                            AS last_at
FROM public.credit_ledger
WHERE reason IN ('ai_build_hold','ai_build_topup','ai_build_credit','ai_message','ai_message_refund','ai_discuss','ai_discuss_refund')
  AND project_id IS NOT NULL
GROUP BY project_id, user_id;