UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email = 'petal-live2-1777594000@example.com';

INSERT INTO public.user_wallets (
  user_id, plan_code, subscription_status,
  monthly_credits_remaining, runtime_free_balance_cents,
  runtime_first_plan_grant_at, current_period_end
)
SELECT id, 'pro', 'active', 300, 500, now(), now() + interval '30 days'
FROM auth.users
WHERE email = 'petal-live2-1777594000@example.com'
ON CONFLICT (user_id) DO UPDATE
SET plan_code = 'pro',
    subscription_status = 'active',
    monthly_credits_remaining = GREATEST(public.user_wallets.monthly_credits_remaining, 300),
    runtime_free_balance_cents = GREATEST(public.user_wallets.runtime_free_balance_cents, 500),
    runtime_first_plan_grant_at = COALESCE(public.user_wallets.runtime_first_plan_grant_at, now()),
    current_period_end = now() + interval '30 days';