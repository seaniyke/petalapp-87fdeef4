INSERT INTO public.economics_config (key, value) VALUES
  ('target_variable_cost_per_credit_usd', 0.030),
  ('target_gross_margin_pct', 80),
  ('compute_hour_usd', 0.150),
  ('credit_retail_usd_cents', 15)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;