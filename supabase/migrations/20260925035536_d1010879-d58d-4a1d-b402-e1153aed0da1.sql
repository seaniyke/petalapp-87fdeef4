DROP FUNCTION IF EXISTS public.apply_paystack_topup(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.apply_paystack_topup(
  _user_id uuid,
  _pack_code text,
  _reference text,
  _environment text,
  _custom_credits numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _credits     numeric(10,2);
  _new_balance numeric(10,2);
BEGIN
  IF EXISTS (SELECT 1 FROM public.topup_lots WHERE stripe_session_id = _reference) THEN
    RETURN;
  END IF;

  IF _pack_code = 'custom' THEN
    _credits := round(COALESCE(_custom_credits, 0), 2);
    IF _credits <= 0 THEN
      RAISE EXCEPTION 'Custom top-up needs a positive credit amount';
    END IF;
  ELSE
    SELECT credits INTO _credits FROM public.credit_packs WHERE code = _pack_code;
    IF _credits IS NULL THEN
      RAISE EXCEPTION 'Unknown pack: %', _pack_code;
    END IF;
  END IF;

  INSERT INTO public.user_wallets (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.topup_lots (
    user_id, pack_code, credits_granted, credits_remaining,
    stripe_session_id, environment, expires_at
  )
  VALUES (_user_id, _pack_code, _credits, _credits, _reference, _environment, NULL);

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
$function$;

REVOKE ALL ON FUNCTION public.apply_paystack_topup(uuid, text, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paystack_topup(uuid, text, text, text, numeric) TO service_role;

INSERT INTO public.economics_config (key, value)
VALUES ('min_purchase_usd_cents', 300)
ON CONFLICT (key) DO NOTHING;

DELETE FROM public.economics_config WHERE key = 'min_purchase_ngn';