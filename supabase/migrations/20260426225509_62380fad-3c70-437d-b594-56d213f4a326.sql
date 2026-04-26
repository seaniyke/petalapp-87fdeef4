-- =========================================================
-- PAYSTACK BILLING — multi-currency, no recurring subscriptions
-- =========================================================

-- ---------- Currencies catalog ----------
CREATE TABLE public.billing_currencies (
  code               text PRIMARY KEY,
  name               text NOT NULL,
  symbol             text NOT NULL,
  usd_rate           numeric(14, 6) NOT NULL DEFAULT 1,
  is_active          boolean NOT NULL DEFAULT true,
  paystack_supported boolean NOT NULL DEFAULT true,
  sort_order         int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_currencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Currencies are viewable by everyone"
  ON public.billing_currencies FOR SELECT USING (true);
CREATE POLICY "Admins can insert currencies"
  ON public.billing_currencies FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update currencies"
  ON public.billing_currencies FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete currencies"
  ON public.billing_currencies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_billing_currencies_updated_at
  BEFORE UPDATE ON public.billing_currencies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed currencies BEFORE adding the FK column on user_wallets.
INSERT INTO public.billing_currencies (code, name, symbol, usd_rate, sort_order, paystack_supported) VALUES
  ('USD', 'US Dollar',          '$',    1,        1, true),
  ('NGN', 'Nigerian Naira',     '₦',    1600,     2, true),
  ('GHS', 'Ghanaian Cedi',      '₵',    15,       3, true),
  ('KES', 'Kenyan Shilling',    'KSh',  130,      4, true),
  ('ZAR', 'South African Rand', 'R',    18,       5, true);

-- ---------- Per-currency price overrides ----------
CREATE TABLE public.billing_price_overrides (
  item_kind     text NOT NULL CHECK (item_kind IN ('plan','pack')),
  item_code     text NOT NULL,
  currency_code text NOT NULL REFERENCES public.billing_currencies(code) ON DELETE CASCADE,
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_kind, item_code, currency_code)
);
ALTER TABLE public.billing_price_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Price overrides are viewable by everyone"
  ON public.billing_price_overrides FOR SELECT USING (true);
CREATE POLICY "Admins can insert price overrides"
  ON public.billing_price_overrides FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update price overrides"
  ON public.billing_price_overrides FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete price overrides"
  ON public.billing_price_overrides FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_billing_price_overrides_updated_at
  BEFORE UPDATE ON public.billing_price_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Paystack webhook idempotency ----------
CREATE TABLE public.paystack_events (
  id           text PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb,
  processed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paystack_events ENABLE ROW LEVEL SECURITY;

-- ---------- Paystack transactions ----------
CREATE TABLE public.paystack_transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reference           text NOT NULL UNIQUE,
  paystack_reference  text,
  purpose             text NOT NULL CHECK (purpose IN ('plan','pack')),
  item_code           text NOT NULL,
  currency_code       text NOT NULL REFERENCES public.billing_currencies(code),
  amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
  usd_amount_cents    integer NOT NULL CHECK (usd_amount_cents >= 0),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','success','failed','abandoned')),
  channel             text,
  environment         text NOT NULL DEFAULT 'test',
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_paystack_tx_user      ON public.paystack_transactions(user_id);
CREATE INDEX idx_paystack_tx_status    ON public.paystack_transactions(status);
ALTER TABLE public.paystack_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own paystack transactions"
  ON public.paystack_transactions FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_paystack_tx_updated_at
  BEFORE UPDATE ON public.paystack_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Wallet: remember preferred currency ----------
ALTER TABLE public.user_wallets
  ADD COLUMN preferred_currency text NOT NULL DEFAULT 'USD'
    REFERENCES public.billing_currencies(code);

-- ---------- RPC: apply Paystack top-up purchase ----------
CREATE OR REPLACE FUNCTION public.apply_paystack_topup(
  _user_id     uuid,
  _pack_code   text,
  _reference   text,
  _environment text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _credits     integer;
  _new_balance integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.topup_lots WHERE stripe_session_id = _reference) THEN
    RETURN;
  END IF;

  SELECT credits INTO _credits FROM public.credit_packs WHERE code = _pack_code;
  IF _credits IS NULL THEN
    RAISE EXCEPTION 'Unknown pack: %', _pack_code;
  END IF;

  INSERT INTO public.user_wallets (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.topup_lots (
    user_id, pack_code, credits_granted, credits_remaining,
    stripe_session_id, environment, expires_at
  )
  VALUES (
    _user_id, _pack_code, _credits, _credits,
    _reference, _environment, now() + interval '12 months'
  );

  UPDATE public.user_wallets
  SET topup_credits_remaining = topup_credits_remaining + _credits,
      updated_at = now()
  WHERE user_id = _user_id
  RETURNING topup_credits_remaining INTO _new_balance;

  INSERT INTO public.credit_ledger (user_id, delta, balance_after, reason, metadata)
  VALUES (
    _user_id, _credits, _new_balance, 'topup',
    jsonb_build_object('pack', _pack_code, 'paystack_reference', _reference, 'provider', 'paystack')
  );
END;
$$;

-- ---------- RPC: apply Paystack plan grant ----------
CREATE OR REPLACE FUNCTION public.apply_paystack_plan_grant(
  _user_id   uuid,
  _plan_code text,
  _reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _monthly     integer;
  _new_balance integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE reason = 'monthly_grant'
      AND metadata ->> 'paystack_reference' = _reference
  ) THEN
    RETURN;
  END IF;

  SELECT monthly_credits INTO _monthly FROM public.billing_plans WHERE code = _plan_code;
  IF _monthly IS NULL THEN
    RAISE EXCEPTION 'Unknown plan: %', _plan_code;
  END IF;

  INSERT INTO public.user_wallets (
    user_id, plan_code, monthly_credits_remaining,
    current_period_end, subscription_status
  )
  VALUES (
    _user_id, _plan_code, _monthly,
    now() + interval '30 days', 'active'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    plan_code                 = _plan_code,
    monthly_credits_remaining = _monthly,
    current_period_end        = now() + interval '30 days',
    subscription_status       = 'active',
    pending_plan_code         = NULL,
    pending_plan_change_at    = NULL,
    updated_at                = now();

  SELECT monthly_credits_remaining INTO _new_balance
  FROM public.user_wallets WHERE user_id = _user_id;

  INSERT INTO public.credit_ledger (user_id, delta, balance_after, reason, metadata)
  VALUES (
    _user_id, _monthly, _new_balance, 'monthly_grant',
    jsonb_build_object('plan', _plan_code, 'paystack_reference', _reference, 'provider', 'paystack')
  );
END;
$$;

-- ---------- Daily sweep: revert expired plans to free ----------
CREATE OR REPLACE FUNCTION public.expire_paystack_plans()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _w RECORD;
BEGIN
  FOR _w IN
    SELECT user_id, plan_code
    FROM public.user_wallets
    WHERE plan_code <> 'free'
      AND current_period_end IS NOT NULL
      AND current_period_end < now()
  LOOP
    UPDATE public.user_wallets
    SET plan_code                 = 'free',
        monthly_credits_remaining = 0,
        subscription_status       = 'expired',
        updated_at                = now()
    WHERE user_id = _w.user_id;

    INSERT INTO public.credit_ledger (user_id, delta, balance_after, reason, metadata)
    VALUES (
      _w.user_id, 0, 0, 'rollover',
      jsonb_build_object('from_plan', _w.plan_code, 'to_plan', 'free', 'reason', 'plan_expired')
    );
  END LOOP;
END;
$$;
