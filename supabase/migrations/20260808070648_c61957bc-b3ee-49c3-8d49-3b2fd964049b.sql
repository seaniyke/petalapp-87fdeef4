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
  w         public.user_wallets%ROWTYPE;
BEGIN
  IF _project_id IS NULL OR _build_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Idempotency: one build can only ever be refunded once.
  SELECT * INTO existing FROM public.credit_ledger WHERE turn_id = _build_id LIMIT 1;
  IF FOUND THEN
    RETURN 0;
  END IF;

  -- The charge we are reversing: the most recent build charge on this project.
  SELECT * INTO charge
  FROM public.credit_ledger
  WHERE project_id = _project_id
    AND delta < 0
    AND reason = 'ai_build_charge'
    AND created_at > now() - interval '6 hours'
  ORDER BY created_at DESC
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
  UPDATE public.user_wallets
     SET credit_debt = GREATEST(0, COALESCE(credit_debt, 0) - pay_debt),
         topup_credits_remaining = topup_credits_remaining + (amt - pay_debt)
   WHERE user_id = charge.user_id
   RETURNING * INTO w;

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