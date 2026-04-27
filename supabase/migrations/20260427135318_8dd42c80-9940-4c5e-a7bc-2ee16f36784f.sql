-- 1) System settings: arbitrary admin-editable config
CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Settings are viewable by everyone"
ON public.system_settings FOR SELECT TO public USING (true);

CREATE POLICY "Admins can insert settings"
ON public.system_settings FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update settings"
ON public.system_settings FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete settings"
ON public.system_settings FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_system_settings_updated_at
BEFORE UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed current hardcoded defaults
INSERT INTO public.system_settings (key, value, description) VALUES
  ('ai.model_fast', '"google/gemini-3-flash-preview"'::jsonb, 'Default fast model for AI generate'),
  ('ai.model_best', '"google/gemini-2.5-pro"'::jsonb, 'Best/heavy model for AI generate'),
  ('ai.model_vision', '"google/gemini-2.5-pro"'::jsonb, 'Model used when vision/images are present'),
  ('ai.model_discuss', '"google/gemini-3-flash-preview"'::jsonb, 'Model for discuss/plan mode'),
  ('ai.model_discuss_vision', '"google/gemini-2.5-pro"'::jsonb, 'Discuss model when vision is present'),
  ('build.hold_credits', '1.00'::jsonb, 'Initial credit hold amount per build message'),
  ('build.discuss_credits', '1.00'::jsonb, 'Credits charged per discuss/plan message'),
  ('build.heavy_keywords', '["redesign","rewrite","refactor everything","whole app","entire app","large refactor"]'::jsonb, 'Prompt keywords that trigger the best model'),
  ('build.heavy_file_count_threshold', '12'::jsonb, 'File count threshold for heavy build classification'),
  ('build.heavy_prompt_length_threshold', '240'::jsonb, 'Prompt length threshold for heavy build classification')
ON CONFLICT (key) DO NOTHING;

-- 2) Admin write policies on billing_plans
CREATE POLICY "Admins can insert plans"
ON public.billing_plans FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update plans"
ON public.billing_plans FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete plans"
ON public.billing_plans FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) Admin write policies on credit_packs
CREATE POLICY "Admins can insert credit packs"
ON public.credit_packs FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update credit packs"
ON public.credit_packs FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete credit packs"
ON public.credit_packs FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4) Admin read access to all wallets, profiles, ledger, transactions, projects
-- Wallets, ledger, paystack_transactions, subscriptions, topup_lots already include
-- has_role(auth.uid(),'admin') checks. Add the same for projects/profiles where needed.

-- Admin can view all profiles (already public-readable, but explicit)
-- Admin can view all auth.users via service role only — handled in RPC below.

-- 5) Admin RPC: list users with wallet + role summary
CREATE OR REPLACE FUNCTION public.admin_list_users(
  _search TEXT DEFAULT NULL,
  _limit INT DEFAULT 50,
  _offset INT DEFAULT 0
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ,
  plan_code TEXT,
  monthly_credits_remaining NUMERIC,
  topup_credits_remaining NUMERIC,
  daily_free_used NUMERIC,
  is_admin BOOLEAN,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT u.id, u.email::text AS email, u.created_at,
           p.display_name, p.avatar_url
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
     WHERE _search IS NULL
        OR u.email ILIKE '%'||_search||'%'
        OR COALESCE(p.display_name,'') ILIKE '%'||_search||'%'
  ),
  counted AS (
    SELECT (SELECT count(*) FROM base) AS total
  ),
  page AS (
    SELECT * FROM base ORDER BY created_at DESC LIMIT _limit OFFSET _offset
  )
  SELECT page.id,
         page.email,
         page.display_name,
         page.avatar_url,
         page.created_at,
         COALESCE(w.plan_code, 'free') AS plan_code,
         COALESCE(w.monthly_credits_remaining, 0) AS monthly_credits_remaining,
         COALESCE(w.topup_credits_remaining, 0) AS topup_credits_remaining,
         COALESCE(w.daily_free_used, 0) AS daily_free_used,
         EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = page.id AND r.role = 'admin'::app_role) AS is_admin,
         counted.total AS total_count
    FROM page
    CROSS JOIN counted
    LEFT JOIN public.user_wallets w ON w.user_id = page.id;
END;
$$;

-- 6) Admin RPC: grant credits to any user
CREATE OR REPLACE FUNCTION public.admin_grant_credits(
  _user_id UUID,
  _amount NUMERIC,
  _bucket TEXT DEFAULT 'topup',
  _reason TEXT DEFAULT 'admin_grant'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id UUID := auth.uid();
BEGIN
  IF NOT public.has_role(_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  PERFORM public.grant_credits(
    _user_id,
    _amount::int,
    _bucket,
    _reason,
    jsonb_build_object('granted_by', _admin_id::text)
  );
END;
$$;

-- 7) Admin RPC: deduct/clawback credits (admin can manually spend)
CREATE OR REPLACE FUNCTION public.admin_deduct_credits(
  _user_id UUID,
  _amount NUMERIC,
  _reason TEXT DEFAULT 'admin_deduct'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id UUID := auth.uid();
  _ledger_id UUID;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  _ledger_id := public.spend_credit(
    _user_id,
    _amount,
    _reason,
    NULL,
    jsonb_build_object('deducted_by', _admin_id::text)
  );

  IF _ledger_id IS NULL THEN
    RAISE EXCEPTION 'Insufficient balance to deduct %', _amount;
  END IF;

  RETURN _ledger_id;
END;
$$;

-- 8) Admin RPC: set/unset admin role
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  _user_id UUID,
  _role app_role,
  _grant BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id UUID := auth.uid();
BEGIN
  IF NOT public.has_role(_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Prevent removing the last admin
  IF _role = 'admin'::app_role AND _grant = false THEN
    IF (SELECT count(*) FROM public.user_roles WHERE role = 'admin'::app_role) <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin';
    END IF;
  END IF;

  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
  END IF;
END;
$$;

-- 9) Admin RPC: refund a specific ledger entry (wraps existing refund_credit)
CREATE OR REPLACE FUNCTION public.admin_refund_ledger(
  _user_id UUID,
  _ledger_id UUID,
  _reason TEXT DEFAULT 'admin_refund'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_id UUID := auth.uid();
BEGIN
  IF NOT public.has_role(_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN public.refund_credit(
    _user_id,
    _ledger_id,
    _reason,
    jsonb_build_object('refunded_by', _admin_id::text)
  );
END;
$$;

-- 10) Admin RPC: list paystack transactions with filters + total
CREATE OR REPLACE FUNCTION public.admin_list_transactions(
  _status TEXT DEFAULT NULL,
  _purpose TEXT DEFAULT NULL,
  _search TEXT DEFAULT NULL,
  _limit INT DEFAULT 50,
  _offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_email TEXT,
  reference TEXT,
  paystack_reference TEXT,
  purpose TEXT,
  status TEXT,
  amount_minor BIGINT,
  currency_code TEXT,
  usd_amount_cents INT,
  item_code TEXT,
  channel TEXT,
  environment TEXT,
  created_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT t.*, u.email::text AS user_email
      FROM public.paystack_transactions t
      LEFT JOIN auth.users u ON u.id = t.user_id
     WHERE (_status  IS NULL OR t.status  = _status)
       AND (_purpose IS NULL OR t.purpose = _purpose)
       AND (_search  IS NULL
            OR t.reference ILIKE '%'||_search||'%'
            OR COALESCE(t.paystack_reference,'') ILIKE '%'||_search||'%'
            OR COALESCE(u.email::text,'') ILIKE '%'||_search||'%')
  ),
  counted AS (SELECT count(*) AS total FROM base),
  page AS (SELECT * FROM base ORDER BY created_at DESC LIMIT _limit OFFSET _offset)
  SELECT page.id, page.user_id, page.user_email, page.reference, page.paystack_reference,
         page.purpose, page.status, page.amount_minor, page.currency_code,
         page.usd_amount_cents, page.item_code, page.channel, page.environment,
         page.created_at, page.paid_at, counted.total
    FROM page CROSS JOIN counted;
END;
$$;