CREATE OR REPLACE FUNCTION public.check_credit_balance(_user_id uuid, _amount numeric)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  w public.user_wallets%ROWTYPE;
  plan public.billing_plans%ROWTYPE;
  today date := (now() AT TIME ZONE 'utc')::date;
  this_month date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
  daily_avail numeric(10,2);
  monthly_cap_avail numeric(10,2);
  free_avail numeric(10,2);
  total_avail numeric(10,2);
  daily_used_eff numeric(10,2);
  monthly_used_eff numeric(10,2);
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN false;
  END IF;

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id;
  IF NOT FOUND THEN
    SELECT * INTO plan FROM public.billing_plans WHERE code = 'free' LIMIT 1;
    daily_avail := COALESCE(plan.daily_free_credits, 0);
    monthly_cap_avail := COALESCE(plan.monthly_free_cap, daily_avail);
    free_avail := LEAST(daily_avail, monthly_cap_avail);
    RETURN free_avail >= _amount;
  END IF;

  SELECT * INTO plan FROM public.billing_plans WHERE code = w.plan_code;
  daily_used_eff := CASE WHEN w.daily_free_reset_at < today THEN 0 ELSE w.daily_free_used END;
  monthly_used_eff := CASE WHEN w.monthly_free_reset_at < this_month THEN 0 ELSE w.monthly_free_used END;
  daily_avail := GREATEST(COALESCE(plan.daily_free_credits, 0) - daily_used_eff, 0);
  IF plan.monthly_free_cap IS NULL THEN
    monthly_cap_avail := daily_avail;
  ELSE
    monthly_cap_avail := GREATEST(plan.monthly_free_cap - monthly_used_eff, 0);
  END IF;
  free_avail := LEAST(daily_avail, monthly_cap_avail);
  total_avail := free_avail + COALESCE(w.monthly_credits_remaining, 0) + COALESCE(w.topup_credits_remaining, 0);
  RETURN total_avail >= _amount;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_credit_balance(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_credit_balance(uuid, numeric) TO authenticated, service_role;