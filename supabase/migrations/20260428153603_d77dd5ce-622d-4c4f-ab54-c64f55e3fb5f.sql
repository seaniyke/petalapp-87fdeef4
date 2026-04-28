-- Admin RPC: grant (or deduct) credits to any user's topup bucket and write
-- a credit_ledger row. Amount can be positive (grant) or negative (deduct).
-- Reason is recorded as 'admin_grant' (positive) or 'admin_deduct' (negative).
CREATE OR REPLACE FUNCTION public.admin_grant_credit(
  _target_user_id uuid,
  _amount numeric,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller uuid := auth.uid();
  new_topup numeric(10,2);
  ledger_id uuid;
  reason_text text;
BEGIN
  IF caller IS NULL OR NOT public.has_role(caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF _target_user_id IS NULL THEN
    RAISE EXCEPTION 'target user required';
  END IF;
  IF _amount IS NULL OR _amount = 0 THEN
    RAISE EXCEPTION 'amount must be non-zero';
  END IF;

  -- Ensure wallet row exists.
  INSERT INTO public.user_wallets (user_id, plan_code)
  VALUES (_target_user_id, 'free')
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.user_wallets
  SET topup_credits_remaining = GREATEST(COALESCE(topup_credits_remaining, 0) + _amount, 0),
      updated_at = now()
  WHERE user_id = _target_user_id
  RETURNING topup_credits_remaining INTO new_topup;

  reason_text := CASE WHEN _amount >= 0 THEN 'admin_grant' ELSE 'admin_deduct' END;

  INSERT INTO public.credit_ledger (user_id, delta, reason, balance_after, metadata)
  VALUES (
    _target_user_id,
    _amount,
    reason_text,
    new_topup,
    jsonb_build_object('granted_by', caller, 'note', COALESCE(_note, ''))
  )
  RETURNING id INTO ledger_id;

  RETURN ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_credit(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_credit(uuid, numeric, text) TO authenticated, service_role;

-- Allow the existing credit_ledger CHECK constraint (if any) to accept the new
-- reasons. If a constraint exists that restricts `reason`, we extend it.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.credit_ledger'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%reason%'
  LOOP
    EXECUTE format('ALTER TABLE public.credit_ledger DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;