-- ============================================================
-- BILLING SYSTEM — Phase 1 (schema, functions, seed, backfill)
-- ============================================================

-- ---------- Catalog: plans ----------
CREATE TABLE public.billing_plans (
  code                 text PRIMARY KEY,
  name                 text NOT NULL,
  tier                 text NOT NULL CHECK (tier IN ('free','pro','business')),
  monthly_credits      int  NOT NULL DEFAULT 0,
  daily_free_credits   int  NOT NULL DEFAULT 0,
  monthly_free_cap     int,                              -- NULL = no cap
  stripe_price_id      text,
  price_cents          int  NOT NULL DEFAULT 0,
  features             jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order           int  NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans are viewable by everyone"
  ON public.billing_plans FOR SELECT USING (true);
CREATE TRIGGER trg_billing_plans_updated_at
  BEFORE UPDATE ON public.billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Catalog: top-up packs ----------
CREATE TABLE public.credit_packs (
  code              text PRIMARY KEY,
  name              text NOT NULL,
  credits           int  NOT NULL,
  price_cents       int  NOT NULL,
  stripe_price_id   text,
  sort_order        int  NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Credit packs are viewable by everyone"
  ON public.credit_packs FOR SELECT USING (true);

-- ---------- Per-user wallet ----------
CREATE TABLE public.user_wallets (
  user_id                    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_code                  text NOT NULL DEFAULT 'free' REFERENCES public.billing_plans(code),
  monthly_credits_remaining  int  NOT NULL DEFAULT 0,
  topup_credits_remaining    int  NOT NULL DEFAULT 0,
  daily_free_used            int  NOT NULL DEFAULT 0,
  daily_free_reset_at        date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  monthly_free_used          int  NOT NULL DEFAULT 0,
  monthly_free_reset_at      date NOT NULL DEFAULT date_trunc('month', now() AT TIME ZONE 'utc')::date,
  stripe_customer_id         text UNIQUE,
  stripe_subscription_id     text UNIQUE,
  subscription_status        text,
  current_period_end         timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own wallet"
  ON public.user_wallets FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
-- No INSERT/UPDATE/DELETE policies → only service role + SECURITY DEFINER funcs can write.
CREATE TRIGGER trg_user_wallets_updated_at
  BEFORE UPDATE ON public.user_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_user_wallets_stripe_customer ON public.user_wallets(stripe_customer_id);
CREATE INDEX idx_user_wallets_stripe_sub      ON public.user_wallets(stripe_subscription_id);

-- ---------- Append-only ledger ----------
CREATE TABLE public.credit_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta          int  NOT NULL,
  reason         text NOT NULL CHECK (reason IN (
                   'ai_message','daily_free','monthly_grant','topup',
                   'admin_grant','refund','rollover','signup_bonus','early_user_bonus'
                 )),
  balance_after  int  NOT NULL,
  project_id     uuid,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own ledger"
  ON public.credit_ledger FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX idx_credit_ledger_user_created
  ON public.credit_ledger(user_id, created_at DESC);

-- ---------- Stripe webhook idempotency ----------
CREATE TABLE public.stripe_events (
  id            text PRIMARY KEY,
  type          text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  payload       jsonb
);
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
-- Only service role can read/write — no policies = no public access.

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Atomic credit spend. Returns true if the spend succeeded.
-- Order of consumption: daily_free → monthly_free (free plan) →
-- monthly_credits (paid grant) → topup_credits (purchased top-ups).
CREATE OR REPLACE FUNCTION public.spend_credit(
  _user_id    uuid,
  _reason     text DEFAULT 'ai_message',
  _project_id uuid DEFAULT NULL,
  _metadata   jsonb DEFAULT '{}'::jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w           public.user_wallets%ROWTYPE;
  plan        public.billing_plans%ROWTYPE;
  today       date := (now() AT TIME ZONE 'utc')::date;
  this_month  date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
  source      text := NULL;
  new_balance int;
BEGIN
  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Create on the fly for any auth user that somehow missed the trigger.
    INSERT INTO public.user_wallets(user_id) VALUES (_user_id)
    RETURNING * INTO w;
  END IF;

  SELECT * INTO plan FROM public.billing_plans WHERE code = w.plan_code;

  -- Refill daily free bucket if a new UTC day.
  IF w.daily_free_reset_at < today THEN
    w.daily_free_used := 0;
    w.daily_free_reset_at := today;
  END IF;
  -- Refill monthly free bucket on month change.
  IF w.monthly_free_reset_at < this_month THEN
    w.monthly_free_used := 0;
    w.monthly_free_reset_at := this_month;
  END IF;

  -- Try free daily allowance first.
  IF w.daily_free_used < plan.daily_free_credits
     AND (plan.monthly_free_cap IS NULL OR w.monthly_free_used < plan.monthly_free_cap) THEN
    w.daily_free_used := w.daily_free_used + 1;
    w.monthly_free_used := w.monthly_free_used + 1;
    source := 'daily_free';
  -- Then monthly paid grant.
  ELSIF w.monthly_credits_remaining > 0 THEN
    w.monthly_credits_remaining := w.monthly_credits_remaining - 1;
    source := 'monthly_grant';
  -- Then top-up balance.
  ELSIF w.topup_credits_remaining > 0 THEN
    w.topup_credits_remaining := w.topup_credits_remaining - 1;
    source := 'topup';
  ELSE
    RETURN false;
  END IF;

  UPDATE public.user_wallets
     SET daily_free_used           = w.daily_free_used,
         daily_free_reset_at       = w.daily_free_reset_at,
         monthly_free_used         = w.monthly_free_used,
         monthly_free_reset_at     = w.monthly_free_reset_at,
         monthly_credits_remaining = w.monthly_credits_remaining,
         topup_credits_remaining   = w.topup_credits_remaining
   WHERE user_id = _user_id;

  new_balance := GREATEST(plan.daily_free_credits - w.daily_free_used, 0)
               + w.monthly_credits_remaining
               + w.topup_credits_remaining;

  INSERT INTO public.credit_ledger(user_id, delta, reason, balance_after, project_id, metadata)
  VALUES (_user_id, -1, _reason, new_balance, _project_id,
          _metadata || jsonb_build_object('source', source));

  RETURN true;
END;
$$;

-- Add credits (used by webhooks, admin tools, signup bonus).
-- bucket = 'monthly' (resets on renewal) or 'topup' (rolling).
CREATE OR REPLACE FUNCTION public.grant_credits(
  _user_id   uuid,
  _amount    int,
  _bucket    text,
  _reason    text,
  _metadata  jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w           public.user_wallets%ROWTYPE;
  plan        public.billing_plans%ROWTYPE;
  new_balance int;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  IF _bucket NOT IN ('monthly','topup') THEN
    RAISE EXCEPTION 'bucket must be monthly or topup';
  END IF;

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_wallets(user_id) VALUES (_user_id) RETURNING * INTO w;
  END IF;

  IF _bucket = 'monthly' THEN
    UPDATE public.user_wallets
       SET monthly_credits_remaining = monthly_credits_remaining + _amount
     WHERE user_id = _user_id
     RETURNING * INTO w;
  ELSE
    UPDATE public.user_wallets
       SET topup_credits_remaining = topup_credits_remaining + _amount
     WHERE user_id = _user_id
     RETURNING * INTO w;
  END IF;

  SELECT * INTO plan FROM public.billing_plans WHERE code = w.plan_code;
  new_balance := GREATEST(plan.daily_free_credits - w.daily_free_used, 0)
               + w.monthly_credits_remaining
               + w.topup_credits_remaining;

  INSERT INTO public.credit_ledger(user_id, delta, reason, balance_after, metadata)
  VALUES (_user_id, _amount, _reason, new_balance, _metadata);
END;
$$;

-- Switch a user's plan (admin tool / Stripe webhook).
CREATE OR REPLACE FUNCTION public.set_user_plan(
  _user_id   uuid,
  _plan_code text,
  _stripe_customer_id text DEFAULT NULL,
  _stripe_subscription_id text DEFAULT NULL,
  _subscription_status text DEFAULT NULL,
  _current_period_end timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.billing_plans WHERE code = _plan_code) THEN
    RAISE EXCEPTION 'unknown plan %', _plan_code;
  END IF;
  INSERT INTO public.user_wallets(user_id, plan_code, stripe_customer_id,
                                  stripe_subscription_id, subscription_status, current_period_end)
  VALUES (_user_id, _plan_code, _stripe_customer_id,
          _stripe_subscription_id, _subscription_status, _current_period_end)
  ON CONFLICT (user_id) DO UPDATE
    SET plan_code               = EXCLUDED.plan_code,
        stripe_customer_id      = COALESCE(EXCLUDED.stripe_customer_id, public.user_wallets.stripe_customer_id),
        stripe_subscription_id  = COALESCE(EXCLUDED.stripe_subscription_id, public.user_wallets.stripe_subscription_id),
        subscription_status     = COALESCE(EXCLUDED.subscription_status, public.user_wallets.subscription_status),
        current_period_end      = COALESCE(EXCLUDED.current_period_end, public.user_wallets.current_period_end);
END;
$$;

-- Extend handle_new_user to auto-create a wallet on signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  INSERT INTO public.user_wallets (user_id, plan_code) VALUES (NEW.id, 'free')
    ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ============================================================
-- SEED: plans + top-up packs
-- ============================================================
INSERT INTO public.billing_plans
  (code, name, tier, monthly_credits, daily_free_credits, monthly_free_cap, price_cents, sort_order, features) VALUES
  ('free',     'Free',     'free',     0,    5, 30,  0,    1, '{"top_ups": false}'),
  ('pro',      'Pro',      'pro',      200,  5, NULL, 2000, 2, '{"top_ups": true, "custom_domain": true, "hide_badge": true}'),
  ('business', 'Business', 'business', 1500, 5, NULL, 9900, 3, '{"top_ups": true, "custom_domain": true, "hide_badge": true, "priority_support": true}');

INSERT INTO public.credit_packs (code, name, credits, price_cents, sort_order) VALUES
  ('pack_50',   '50 credits',    50,  1000, 1),
  ('pack_200',  '200 credits',   200, 3500, 2),
  ('pack_1000', '1000 credits', 1000, 15000, 3);

-- ============================================================
-- BACKFILL existing users: Free plan + 100 bonus credits
-- ============================================================
DO $$
DECLARE u RECORD;
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    INSERT INTO public.user_wallets (user_id, plan_code)
    VALUES (u.id, 'free')
    ON CONFLICT (user_id) DO NOTHING;

    -- Grant 100 bonus credits as top-up balance, but only to users who don't already have one logged.
    IF NOT EXISTS (
      SELECT 1 FROM public.credit_ledger
      WHERE user_id = u.id AND reason = 'early_user_bonus'
    ) THEN
      PERFORM public.grant_credits(u.id, 100, 'topup', 'early_user_bonus',
        jsonb_build_object('note', 'Thank you for being an early Petal user'));
    END IF;
  END LOOP;
END $$;