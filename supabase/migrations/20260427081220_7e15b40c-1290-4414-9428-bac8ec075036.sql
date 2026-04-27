
-- refund_credit: returns 1 credit to the user, mirroring the most recent
-- spend. Used when an AI call we already charged for fails upstream.
-- Returns true if a refund happened, false if there's nothing to refund.
CREATE OR REPLACE FUNCTION public.refund_credit(
  _user_id   uuid,
  _reason    text DEFAULT 'ai_message_refund',
  _project_id uuid DEFAULT NULL,
  _metadata  jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w           public.user_wallets%ROWTYPE;
  plan        public.billing_plans%ROWTYPE;
  last_spend  public.credit_ledger%ROWTYPE;
  source      text;
  new_balance int;
BEGIN
  -- Find the most recent spend for this user (delta = -1) so we know which
  -- bucket to refund into. If we can't find one, refuse — refunding blindly
  -- would let us inflate balances.
  SELECT * INTO last_spend
  FROM public.credit_ledger
  WHERE user_id = _user_id
    AND delta = -1
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  source := last_spend.metadata ->> 'source';
  IF source NOT IN ('daily_free', 'monthly_grant', 'topup') THEN
    -- Unknown source — fall back to topup so the credit isn't lost.
    source := 'topup';
  END IF;

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO plan FROM public.billing_plans WHERE code = w.plan_code;

  IF source = 'daily_free' THEN
    -- Refund into the daily/monthly free counters (clamped at 0).
    UPDATE public.user_wallets
       SET daily_free_used   = GREATEST(0, daily_free_used - 1),
           monthly_free_used = GREATEST(0, monthly_free_used - 1)
     WHERE user_id = _user_id
     RETURNING * INTO w;
  ELSIF source = 'monthly_grant' THEN
    UPDATE public.user_wallets
       SET monthly_credits_remaining = monthly_credits_remaining + 1
     WHERE user_id = _user_id
     RETURNING * INTO w;
  ELSE
    UPDATE public.user_wallets
       SET topup_credits_remaining = topup_credits_remaining + 1
     WHERE user_id = _user_id
     RETURNING * INTO w;
  END IF;

  new_balance := GREATEST(plan.daily_free_credits - w.daily_free_used, 0)
               + w.monthly_credits_remaining
               + w.topup_credits_remaining;

  INSERT INTO public.credit_ledger(user_id, delta, reason, balance_after, project_id, metadata)
  VALUES (_user_id, 1, _reason, new_balance, _project_id,
          _metadata || jsonb_build_object('source', source, 'refund_of', last_spend.id));

  RETURN true;
END;
$$;
