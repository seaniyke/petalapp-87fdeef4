CREATE OR REPLACE FUNCTION public.has_full_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT (w.plan_code IS DISTINCT FROM 'free')
             OR COALESCE(w.topup_credits_remaining, 0) > 0
      FROM public.user_wallets w
      WHERE w.user_id = _user_id
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_full_access(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_paid_plan(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_full_access(_user_id);
$$;