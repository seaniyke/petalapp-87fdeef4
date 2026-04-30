UPDATE public.user_wallets
SET
  plan_code = 'pro',
  subscription_status = 'active',
  monthly_credits_remaining = 300,
  monthly_free_reset_at = (now() + interval '30 days')::date,
  runtime_free_balance_cents = CASE
    WHEN runtime_first_plan_grant_at IS NULL THEN runtime_free_balance_cents + 500
    ELSE runtime_free_balance_cents
  END,
  runtime_first_plan_grant_at = COALESCE(runtime_first_plan_grant_at, now()),
  runtime_free_reset_at = (now() + interval '30 days')::date,
  updated_at = now()
WHERE user_id = 'b48caeb6-ab1c-4320-83af-09436a5c4f9c';