-- 1. topup_lots: track each pack purchase with 12-month expiry
CREATE TABLE public.topup_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_code TEXT NOT NULL,
  credits_granted INTEGER NOT NULL,
  credits_remaining INTEGER NOT NULL,
  stripe_session_id TEXT UNIQUE,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_topup_lots_user ON public.topup_lots(user_id);
CREATE INDEX idx_topup_lots_expires ON public.topup_lots(expires_at) WHERE credits_remaining > 0;

ALTER TABLE public.topup_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own topup lots"
  ON public.topup_lots FOR SELECT
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

-- 2. subscriptions table
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  product_id TEXT,
  price_id TEXT NOT NULL,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  pending_plan_code TEXT,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe ON public.subscriptions(stripe_subscription_id);
CREATE INDEX idx_subscriptions_period_end ON public.subscriptions(current_period_end) WHERE cancel_at_period_end = true OR pending_plan_code IS NOT NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

-- 3. wallet: track pending plan changes
ALTER TABLE public.user_wallets
  ADD COLUMN pending_plan_code TEXT,
  ADD COLUMN pending_plan_change_at TIMESTAMPTZ;

-- 4. Update stripe_price_id on existing plans/packs to match Stripe lookup keys
UPDATE public.billing_plans SET stripe_price_id = 'plan_pro_monthly' WHERE code = 'pro';
UPDATE public.billing_plans SET stripe_price_id = 'plan_business_monthly' WHERE code = 'business';
UPDATE public.credit_packs SET stripe_price_id = 'pack_50_onetime' WHERE code = 'pack_50';
UPDATE public.credit_packs SET stripe_price_id = 'pack_200_onetime' WHERE code = 'pack_200';
UPDATE public.credit_packs SET stripe_price_id = 'pack_1000_onetime' WHERE code = 'pack_1000';

-- 5. apply_subscription_activated: grant monthly credits + set plan
CREATE OR REPLACE FUNCTION public.apply_subscription_activated(
  _user_id UUID,
  _plan_code TEXT,
  _stripe_customer_id TEXT,
  _stripe_subscription_id TEXT,
  _current_period_end TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _monthly INTEGER;
  _new_balance INTEGER;
BEGIN
  SELECT monthly_credits INTO _monthly FROM public.billing_plans WHERE code = _plan_code;
  IF _monthly IS NULL THEN
    RAISE EXCEPTION 'Unknown plan code: %', _plan_code;
  END IF;

  -- Upsert wallet
  INSERT INTO public.user_wallets (user_id, plan_code, monthly_credits_remaining, stripe_customer_id, stripe_subscription_id, current_period_end, subscription_status, pending_plan_code, pending_plan_change_at)
  VALUES (_user_id, _plan_code, _monthly, _stripe_customer_id, _stripe_subscription_id, _current_period_end, 'active', NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    plan_code = _plan_code,
    monthly_credits_remaining = _monthly,
    stripe_customer_id = _stripe_customer_id,
    stripe_subscription_id = _stripe_subscription_id,
    current_period_end = _current_period_end,
    subscription_status = 'active',
    pending_plan_code = NULL,
    pending_plan_change_at = NULL,
    updated_at = now();

  SELECT monthly_credits_remaining INTO _new_balance FROM public.user_wallets WHERE user_id = _user_id;

  INSERT INTO public.credit_ledger (user_id, delta, balance_after, reason, metadata)
  VALUES (_user_id, _monthly, _new_balance, 'subscription_activated', jsonb_build_object('plan', _plan_code, 'subscription_id', _stripe_subscription_id));
END;
$$;

-- 6. apply_monthly_renewal: top up monthly credits on each renewal
CREATE OR REPLACE FUNCTION public.apply_monthly_renewal(
  _user_id UUID,
  _plan_code TEXT,
  _current_period_end TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _monthly INTEGER;
  _new_balance INTEGER;
BEGIN
  SELECT monthly_credits INTO _monthly FROM public.billing_plans WHERE code = _plan_code;
  IF _monthly IS NULL THEN RETURN; END IF;

  UPDATE public.user_wallets
  SET monthly_credits_remaining = _monthly,
      current_period_end = _current_period_end,
      subscription_status = 'active',
      updated_at = now()
  WHERE user_id = _user_id;

  SELECT monthly_credits_remaining INTO _new_balance FROM public.user_wallets WHERE user_id = _user_id;

  INSERT INTO public.credit_ledger (user_id, delta, balance_after, reason, metadata)
  VALUES (_user_id, _monthly, _new_balance, 'monthly_renewal', jsonb_build_object('plan', _plan_code));
END;
$$;

-- 7. apply_topup_purchase: grant credits and create expiring lot
CREATE OR REPLACE FUNCTION public.apply_topup_purchase(
  _user_id UUID,
  _pack_code TEXT,
  _stripe_session_id TEXT,
  _environment TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _credits INTEGER;
  _new_balance INTEGER;
BEGIN
  -- Idempotency: skip if already processed
  IF EXISTS (SELECT 1 FROM public.topup_lots WHERE stripe_session_id = _stripe_session_id) THEN
    RETURN;
  END IF;

  SELECT credits INTO _credits FROM public.credit_packs WHERE code = _pack_code;
  IF _credits IS NULL THEN
    RAISE EXCEPTION 'Unknown pack: %', _pack_code;
  END IF;

  -- Ensure wallet exists
  INSERT INTO public.user_wallets (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Create the lot
  INSERT INTO public.topup_lots (user_id, pack_code, credits_granted, credits_remaining, stripe_session_id, environment, expires_at)
  VALUES (_user_id, _pack_code, _credits, _credits, _stripe_session_id, _environment, now() + interval '12 months');

  -- Grant credits to wallet
  UPDATE public.user_wallets
  SET topup_credits_remaining = topup_credits_remaining + _credits,
      updated_at = now()
  WHERE user_id = _user_id
  RETURNING topup_credits_remaining INTO _new_balance;

  INSERT INTO public.credit_ledger (user_id, delta, balance_after, reason, metadata)
  VALUES (_user_id, _credits, _new_balance, 'topup_purchase', jsonb_build_object('pack', _pack_code, 'session_id', _stripe_session_id));
END;
$$;

-- 8. expire_topup_lots: daily sweep
CREATE OR REPLACE FUNCTION public.expire_topup_lots()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lot RECORD;
  _new_balance INTEGER;
BEGIN
  FOR _lot IN
    SELECT id, user_id, credits_remaining, pack_code
    FROM public.topup_lots
    WHERE credits_remaining > 0 AND expires_at <= now()
    FOR UPDATE
  LOOP
    UPDATE public.user_wallets
    SET topup_credits_remaining = GREATEST(0, topup_credits_remaining - _lot.credits_remaining),
        updated_at = now()
    WHERE user_id = _lot.user_id
    RETURNING topup_credits_remaining INTO _new_balance;

    INSERT INTO public.credit_ledger (user_id, delta, balance_after, reason, metadata)
    VALUES (_lot.user_id, -_lot.credits_remaining, COALESCE(_new_balance, 0), 'topup_expired', jsonb_build_object('pack', _lot.pack_code, 'lot_id', _lot.id));

    UPDATE public.topup_lots SET credits_remaining = 0, updated_at = now() WHERE id = _lot.id;
  END LOOP;
END;
$$;

-- 9. apply_period_end_changes: hourly sweep for cancellations + downgrades
CREATE OR REPLACE FUNCTION public.apply_period_end_changes()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sub RECORD;
  _new_plan TEXT;
BEGIN
  FOR _sub IN
    SELECT id, user_id, plan_code, pending_plan_code, cancel_at_period_end, current_period_end, stripe_subscription_id
    FROM public.subscriptions
    WHERE current_period_end IS NOT NULL
      AND current_period_end <= now()
      AND (cancel_at_period_end = true OR pending_plan_code IS NOT NULL)
      AND status NOT IN ('canceled')
  LOOP
    IF _sub.cancel_at_period_end THEN
      _new_plan := 'free';
    ELSE
      _new_plan := _sub.pending_plan_code;
    END IF;

    UPDATE public.user_wallets
    SET plan_code = _new_plan,
        monthly_credits_remaining = 0,
        pending_plan_code = NULL,
        pending_plan_change_at = NULL,
        subscription_status = CASE WHEN _new_plan = 'free' THEN 'canceled' ELSE 'active' END,
        updated_at = now()
    WHERE user_id = _sub.user_id;

    UPDATE public.subscriptions
    SET plan_code = _new_plan,
        pending_plan_code = NULL,
        status = CASE WHEN _new_plan = 'free' THEN 'canceled' ELSE status END,
        updated_at = now()
    WHERE id = _sub.id;

    INSERT INTO public.credit_ledger (user_id, delta, balance_after, reason, metadata)
    VALUES (_sub.user_id, 0, 0, CASE WHEN _new_plan = 'free' THEN 'subscription_canceled' ELSE 'plan_downgraded' END,
            jsonb_build_object('from_plan', _sub.plan_code, 'to_plan', _new_plan));
  END LOOP;
END;
$$;

-- 10. Schedule cron jobs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;

SELECT cron.schedule('expire-topup-lots-daily', '0 3 * * *', $$SELECT public.expire_topup_lots();$$);
SELECT cron.schedule('apply-period-end-changes-hourly', '5 * * * *', $$SELECT public.apply_period_end_changes();$$);