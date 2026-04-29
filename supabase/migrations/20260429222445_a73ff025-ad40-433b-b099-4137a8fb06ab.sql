-- Plan-upgrade one-time runtime grant: $5 credited to the runtime free balance
-- the first time a user pays for any paid plan. Replaces the $10 top-up gate
-- as the on-ramp to backend / email / domain features.

ALTER TABLE public.user_wallets
  ADD COLUMN IF NOT EXISTS runtime_first_plan_grant_at TIMESTAMPTZ;

-- Backfill: any existing wallet that already has a paid plan is treated as
-- "grant already received" so we never retroactively credit them.
UPDATE public.user_wallets
   SET runtime_first_plan_grant_at = COALESCE(runtime_first_plan_grant_at, now())
 WHERE plan_code IS NOT NULL
   AND plan_code <> 'free';

-- ---------- Function: one-time plan-upgrade $5 runtime grant ----------
CREATE OR REPLACE FUNCTION public.grant_first_paid_plan_runtime_credit(
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
  _already       timestamptz;
  _free_after    bigint;
  _topup_after   bigint;
BEGIN
  -- Skip free plans entirely.
  IF _plan_code IS NULL OR _plan_code = 'free' THEN
    RETURN;
  END IF;

  -- Idempotency guard #1: already granted at the wallet level.
  SELECT runtime_first_plan_grant_at INTO _already
    FROM public.user_wallets WHERE user_id = _user_id;
  IF _already IS NOT NULL THEN
    RETURN;
  END IF;

  -- Idempotency guard #2: ledger row keyed by paystack reference.
  IF EXISTS (
    SELECT 1 FROM public.credit_ledger
     WHERE reason = 'first_plan_grant'
       AND metadata ->> 'paystack_reference' = _reference
  ) THEN
    -- Still mark the wallet so future calls short-circuit.
    UPDATE public.user_wallets
       SET runtime_first_plan_grant_at = now(),
           runtime_topup_qualified_at = COALESCE(runtime_topup_qualified_at, now()),
           updated_at = now()
     WHERE user_id = _user_id;
    RETURN;
  END IF;

  -- Apply: +$5 to free balance (capped so we never push existing higher
  -- balance back down), mark qualified for the existing monthly free reset,
  -- and set the one-time grant timestamp.
  UPDATE public.user_wallets
     SET runtime_free_balance_cents = GREATEST(runtime_free_balance_cents, 500),
         runtime_topup_qualified_at = COALESCE(runtime_topup_qualified_at, now()),
         runtime_first_plan_grant_at = now(),
         runtime_free_reset_at = COALESCE(
           runtime_free_reset_at,
           date_trunc('month', now()) + interval '1 month'
         ),
         updated_at = now()
   WHERE user_id = _user_id
   RETURNING runtime_free_balance_cents, runtime_topup_balance_cents
        INTO _free_after, _topup_after;

  -- Audit row in the runtime ledger (credit_ledger is the shared ledger).
  INSERT INTO public.credit_ledger (user_id, project_id, delta, balance_after, reason, metadata)
  VALUES (
    _user_id, NULL, 500, COALESCE(_free_after, 0),
    'first_plan_grant',
    jsonb_build_object(
      'plan', _plan_code,
      'paystack_reference', _reference,
      'provider', 'paystack',
      'amount_cents', 500
    )
  );
END;
$$;

-- ---------- Update apply_paystack_plan_grant to call the new function ----------
-- Re-create the existing function with the new tail call. Body is unchanged
-- except for the final invocation of grant_first_paid_plan_runtime_credit.
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
    -- Even on replay, ensure the one-time runtime grant has fired.
    PERFORM public.grant_first_paid_plan_runtime_credit(_user_id, _plan_code, _reference);
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

  -- One-time runtime $5 grant on first paid plan, ever.
  PERFORM public.grant_first_paid_plan_runtime_credit(_user_id, _plan_code, _reference);
END;
$$;