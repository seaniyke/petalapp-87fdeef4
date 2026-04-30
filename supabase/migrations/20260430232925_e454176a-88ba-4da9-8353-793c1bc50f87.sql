update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email = 'petal-smoketest-1777591710@example.com';

insert into public.user_wallets (
  user_id,
  plan_code,
  subscription_status,
  monthly_credits_remaining,
  runtime_free_balance_cents,
  runtime_first_plan_grant_at
)
select id, 'pro', 'active', 300, 500, now()
from auth.users
where email = 'petal-smoketest-1777591710@example.com'
on conflict (user_id) do update
set plan_code = 'pro',
    subscription_status = 'active',
    monthly_credits_remaining = greatest(public.user_wallets.monthly_credits_remaining, 300),
    runtime_free_balance_cents = greatest(public.user_wallets.runtime_free_balance_cents, 500),
    runtime_first_plan_grant_at = coalesce(public.user_wallets.runtime_first_plan_grant_at, now());