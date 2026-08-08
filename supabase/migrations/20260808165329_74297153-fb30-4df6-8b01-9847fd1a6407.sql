CREATE OR REPLACE FUNCTION public.refund_build_charge(
  _project_id uuid,
  _build_id uuid,
  _reason text DEFAULT 'ai_build_rollback_refund'
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing  public.credit_ledger%ROWTYPE;
  charge    public.credit_ledger%ROWTYPE;
  amt       numeric(10,2);
  pay_debt  numeric(10,2);
  give_back numeric(10,2);
  w         public.user_wallets%ROWTYPE;
  src       jsonb;
  bucket    text;
  bamt      numeric(10,2);
  split     numeric(10,2) := 0;
BEGIN
  IF _project_id IS NULL OR _build_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Idempotency #1: one build can only ever trigger one refund.
  SELECT * INTO existing FROM public.credit_ledger WHERE turn_id = _build_id LIMIT 1;
  IF FOUND THEN
    RETURN 0;
  END IF;

  -- The charge we are reversing. Prefer the charge recorded for THIS build;
  -- fall back to the most recent recent-enough charge on the project.
  -- Either way it must not have been refunded already (idempotency #2) —
  -- without this, every later failed build refunded the same charge again
  -- and the user's balance grew on each retry.
  SELECT * INTO charge
  FROM public.credit_ledger c
  WHERE c.project_id = _project_id
    AND c.delta < 0
    AND c.reason = 'ai_build_charge'
    AND c.created_at > now() - interval '6 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_ledger r
       WHERE r.delta > 0
         AND (r.metadata ->> 'refund_of_ledger') = c.id::text
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_ledger r
       WHERE r.delta > 0
         AND (r.metadata ->> 'refund_of') = c.id::text
    )
  ORDER BY (c.turn_id = _build_id) DESC, c.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  amt := round(ABS(charge.delta), 2);
  IF amt <= 0 THEN
    RETURN 0;
  END IF;

  SELECT * INTO w FROM public.user_wallets WHERE user_id = charge.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Clear any debt this charge created before handing credits back.
  pay_debt := LEAST(COALESCE(w.credit_debt, 0), amt);
  give_back := amt - pay_debt;

  UPDATE public.user_wallets
     SET credit_debt = GREATEST(0, COALESCE(credit_debt, 0) - pay_debt),
         updated_at = now()
   WHERE user_id = charge.user_id;

  -- Return credits to the SAME buckets they were taken from, proportionally.
  IF give_back > 0 THEN
    FOR src IN SELECT jsonb_array_elements(COALESCE(charge.metadata -> 'sources', '[]'::jsonb))
    LOOP
      bucket := src ->> 'bucket';
      bamt   := round(((src ->> 'amount')::numeric) * (give_back / amt), 2);
      IF bamt <= 0 THEN
        CONTINUE;
      END IF;
      split := split + bamt;

      IF bucket = 'daily_free' THEN
        UPDATE public.user_wallets
           SET daily_free_used   = GREATEST(0, daily_free_used   - bamt),
               monthly_free_used = GREATEST(0, monthly_free_used - bamt),
               updated_at = now()
         WHERE user_id = charge.user_id;
      ELSIF bucket = 'monthly_grant' THEN
        UPDATE public.user_wallets
           SET monthly_credits_remaining = monthly_credits_remaining + bamt,
               updated_at = now()
         WHERE user_id = charge.user_id;
      ELSE
        UPDATE public.user_wallets
           SET topup_credits_remaining = topup_credits_remaining + bamt,
               updated_at = now()
         WHERE user_id = charge.user_id;
      END IF;
    END LOOP;

    -- Legacy charges with no `sources` recorded: fall back to purchased credits.
    IF split = 0 THEN
      UPDATE public.user_wallets
         SET topup_credits_remaining = topup_credits_remaining + give_back,
             updated_at = now()
       WHERE user_id = charge.user_id;
    END IF;
  END IF;

  INSERT INTO public.credit_ledger(user_id, delta, balance_after, reason, project_id, turn_id, metadata)
  VALUES (
    charge.user_id,
    amt,
    COALESCE(public.available_credits(charge.user_id), 0),
    _reason,
    _project_id,
    _build_id,
    jsonb_build_object('refund_of_ledger', charge.id, 'build_id', _build_id, 'debt_cleared', pay_debt)
  );

  RETURN amt;
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_build_charge(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_build_charge(uuid, uuid, text) TO service_role;

-- Reverse the duplicate refunds already handed out for charge b3fc6b05 (3 extra x 4.96).
DO $$
DECLARE
  dup record;
  extra numeric(10,2) := 0;
BEGIN
  FOR dup IN
    SELECT id, user_id, delta, project_id
      FROM public.credit_ledger
     WHERE reason = 'ai_build_rollback_refund'
       AND (metadata ->> 'refund_of_ledger') = 'b3fc6b05-2216-4fc8-9054-940f974c9127'
     ORDER BY created_at
     OFFSET 1
  LOOP
    extra := extra + dup.delta;
    UPDATE public.credit_ledger
       SET metadata = metadata || jsonb_build_object('reversed_as_duplicate', true)
     WHERE id = dup.id;

    UPDATE public.user_wallets
       SET topup_credits_remaining = GREATEST(0, topup_credits_remaining - dup.delta),
           updated_at = now()
     WHERE user_id = dup.user_id;

    INSERT INTO public.credit_ledger(user_id, delta, balance_after, reason, project_id, metadata)
    VALUES (dup.user_id, -dup.delta, COALESCE(public.available_credits(dup.user_id), 0),
            'duplicate_refund_reversal', dup.project_id,
            jsonb_build_object('reverses', dup.id::text));
  END LOOP;
END;
$$;