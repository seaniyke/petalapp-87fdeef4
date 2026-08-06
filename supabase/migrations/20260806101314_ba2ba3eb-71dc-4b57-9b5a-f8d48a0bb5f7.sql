create or replace function public.available_credits(_user_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  w public.user_wallets%rowtype;
  plan public.billing_plans%rowtype;
  today date := (now() at time zone 'utc')::date;
  this_month date := date_trunc('month', now() at time zone 'utc')::date;
  daily_avail numeric(10,2);
  monthly_cap_avail numeric(10,2);
  free_avail numeric(10,2);
  daily_used_eff numeric(10,2);
  monthly_used_eff numeric(10,2);
begin
  select * into w from public.user_wallets where user_id = _user_id;
  if not found then
    select * into plan from public.billing_plans where code = 'free' limit 1;
    daily_avail := coalesce(plan.daily_free_credits, 0);
    monthly_cap_avail := coalesce(plan.monthly_free_cap, daily_avail);
    return least(daily_avail, monthly_cap_avail);
  end if;

  select * into plan from public.billing_plans where code = w.plan_code;
  daily_used_eff := case when w.daily_free_reset_at < today then 0 else w.daily_free_used end;
  monthly_used_eff := case when w.monthly_free_reset_at < this_month then 0 else w.monthly_free_used end;
  daily_avail := greatest(coalesce(plan.daily_free_credits, 0) - daily_used_eff, 0);
  if plan.monthly_free_cap is null then
    monthly_cap_avail := daily_avail;
  else
    monthly_cap_avail := greatest(plan.monthly_free_cap - monthly_used_eff, 0);
  end if;
  free_avail := least(daily_avail, monthly_cap_avail);
  return free_avail
       + coalesce(w.monthly_credits_remaining, 0)
       + coalesce(w.topup_credits_remaining, 0);
end;
$$;

revoke all on function public.available_credits(uuid) from public, anon;
grant execute on function public.available_credits(uuid) to authenticated, service_role;