-- 1. Purchased credits never expire.
ALTER TABLE public.topup_lots ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE public.topup_lots ALTER COLUMN expires_at DROP DEFAULT;
UPDATE public.topup_lots SET expires_at = NULL WHERE expires_at IS NOT NULL;

-- 2. apply_topup_purchase: no expiry stamped on new lots.
CREATE OR REPLACE FUNCTION public.apply_topup_purchase(_user_id uuid, _pack_code text, _stripe_session_id text, _environment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _credits INTEGER;
  _new_balance INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM public.topup_lots WHERE stripe_session_id = _stripe_session_id) THEN
    RETURN;
  END IF;

  SELECT credits INTO _credits FROM public.credit_packs WHERE code = _pack_code;
  IF _credits IS NULL THEN
    RAISE EXCEPTION 'Unknown pack: %', _pack_code;
  END IF;

  INSERT INTO public.user_wallets (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- expires_at stays NULL: purchased credits are owned permanently.
  INSERT INTO public.topup_lots (user_id, pack_code, credits_granted, credits_remaining, stripe_session_id, environment, expires_at)
  VALUES (_user_id, _pack_code, _credits, _credits, _stripe_session_id, _environment, NULL);

  UPDATE public.user_wallets
  SET topup_credits_remaining = topup_credits_remaining + _credits,
      updated_at = now()
  WHERE user_id = _user_id
  RETURNING topup_credits_remaining INTO _new_balance;

  INSERT INTO public.credit_ledger (user_id, delta, balance_after, reason, metadata)
  VALUES (_user_id, _credits, _new_balance, 'topup_purchase', jsonb_build_object('pack', _pack_code, 'session_id', _stripe_session_id));
END;
$function$;

-- 3. expire_topup_lots becomes a permanent no-op (kept so any残 scheduled call is harmless).
CREATE OR REPLACE FUNCTION public.expire_topup_lots()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Petal Credit System v2: purchased credits never expire.
  -- Intentionally does nothing. Kept only so legacy schedules/callers no-op.
  RETURN;
END;
$function$;

-- 4. settle_build_charge: idempotency branch read a non-existent column
--    (credit_ledger.amount). It is `delta`. A retried turn used to throw and
--    get logged as an unpaid build.
CREATE OR REPLACE FUNCTION public.settle_build_charge(_user_id uuid, _amount numeric, _reason text DEFAULT 'ai_build_charge'::text, _project_id uuid DEFAULT NULL::uuid, _turn_id uuid DEFAULT NULL::uuid, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(charged numeric, shortfall numeric, ledger_id uuid, idempotent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  existing   public.credit_ledger%ROWTYPE;
  avail      numeric(10,2);
  take       numeric(10,2);
  short      numeric(10,2);
  new_ledger uuid;
BEGIN
  _amount := round(GREATEST(COALESCE(_amount, 0), 0), 2);

  IF _turn_id IS NOT NULL THEN
    SELECT * INTO existing FROM public.credit_ledger WHERE turn_id = _turn_id LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT ABS(existing.delta)::numeric(10,2), 0::numeric(10,2), existing.id, true;
      RETURN;
    END IF;
  END IF;

  IF _amount = 0 THEN
    RETURN QUERY SELECT 0::numeric(10,2), 0::numeric(10,2), NULL::uuid, false;
    RETURN;
  END IF;

  avail := COALESCE(public.available_credits(_user_id), 0);
  take  := LEAST(_amount, GREATEST(floor(avail * 100) / 100, 0));
  short := round(_amount - take, 2);

  IF take > 0 THEN
    new_ledger := public.spend_credit(
      _user_id,
      take,
      _reason,
      _project_id,
      _metadata || jsonb_build_object('priced_amount', _amount, 'shortfall', short)
    );
    IF new_ledger IS NOT NULL AND _turn_id IS NOT NULL THEN
      UPDATE public.credit_ledger SET turn_id = _turn_id WHERE id = new_ledger;
    END IF;
    IF new_ledger IS NULL THEN
      take := 0;
      short := _amount;
    END IF;
  END IF;

  IF short > 0 THEN
    INSERT INTO public.user_wallets(user_id, credit_debt)
    VALUES (_user_id, short)
    ON CONFLICT (user_id) DO UPDATE
      SET credit_debt = public.user_wallets.credit_debt + EXCLUDED.credit_debt;
  END IF;

  RETURN QUERY SELECT take, short, new_ledger, false;
END;
$function$;

-- 5. spend_credit: draw purchased lots down FIFO so topup_lots stays in sync
--    with the wallet balance. Same drain order as before:
--    free -> monthly grant -> purchased.
CREATE OR REPLACE FUNCTION public.spend_credit(_user_id uuid, _amount numeric, _reason text DEFAULT 'ai_message'::text, _project_id uuid DEFAULT NULL::uuid, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w           public.user_wallets%ROWTYPE;
  plan        public.billing_plans%ROWTYPE;
  today       date := (now() AT TIME ZONE 'utc')::date;
  this_month  date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
  ledger_id   uuid;

  daily_avail   numeric(10,2);
  monthly_cap_avail numeric(10,2);
  free_avail    numeric(10,2);
  free_take     numeric(10,2) := 0;
  grant_take    numeric(10,2) := 0;
  topup_take    numeric(10,2) := 0;
  remaining     numeric(10,2);
  total_avail   numeric(10,2);
  new_balance   numeric(10,2);
  sources       jsonb := '[]'::jsonb;
  lot           RECORD;
  lot_left      numeric(10,2);
  lot_take      numeric(10,2);
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0 (got %)', _amount;
  END IF;

  _amount := round(_amount, 2);

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_wallets(user_id) VALUES (_user_id)
    RETURNING * INTO w;
  END IF;

  SELECT * INTO plan FROM public.billing_plans WHERE code = w.plan_code;

  IF w.daily_free_reset_at < today THEN
    w.daily_free_used := 0;
    w.daily_free_reset_at := today;
  END IF;
  IF w.monthly_free_reset_at < this_month THEN
    w.monthly_free_used := 0;
    w.monthly_free_reset_at := this_month;
  END IF;

  daily_avail := GREATEST(plan.daily_free_credits - w.daily_free_used, 0);
  IF plan.monthly_free_cap IS NULL THEN
    monthly_cap_avail := daily_avail;
  ELSE
    monthly_cap_avail := GREATEST(plan.monthly_free_cap - w.monthly_free_used, 0);
  END IF;
  free_avail := LEAST(daily_avail, monthly_cap_avail);

  total_avail := free_avail + w.monthly_credits_remaining + w.topup_credits_remaining;
  IF total_avail < _amount THEN
    RETURN NULL;
  END IF;

  remaining := _amount;

  IF remaining > 0 AND free_avail > 0 THEN
    free_take := LEAST(free_avail, remaining);
    remaining := remaining - free_take;
  END IF;

  IF remaining > 0 AND w.monthly_credits_remaining > 0 THEN
    grant_take := LEAST(w.monthly_credits_remaining, remaining);
    remaining := remaining - grant_take;
  END IF;

  IF remaining > 0 AND w.topup_credits_remaining > 0 THEN
    topup_take := LEAST(w.topup_credits_remaining, remaining);
    remaining := remaining - topup_take;
  END IF;

  IF remaining > 0 THEN
    RETURN NULL;
  END IF;

  UPDATE public.user_wallets
     SET daily_free_used           = w.daily_free_used + free_take,
         daily_free_reset_at       = w.daily_free_reset_at,
         monthly_free_used         = w.monthly_free_used + free_take,
         monthly_free_reset_at     = w.monthly_free_reset_at,
         monthly_credits_remaining = w.monthly_credits_remaining - grant_take,
         topup_credits_remaining   = w.topup_credits_remaining - topup_take,
         updated_at                = now()
   WHERE user_id = _user_id;

  -- Draw purchased lots down oldest-first so lot records match the wallet.
  IF topup_take > 0 THEN
    lot_left := topup_take;
    FOR lot IN
      SELECT id, credits_remaining
      FROM public.topup_lots
      WHERE user_id = _user_id AND credits_remaining > 0
      ORDER BY created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN lot_left <= 0;
      lot_take := LEAST(lot.credits_remaining, lot_left);
      UPDATE public.topup_lots
         SET credits_remaining = credits_remaining - lot_take,
             updated_at = now()
       WHERE id = lot.id;
      lot_left := lot_left - lot_take;
    END LOOP;
  END IF;

  new_balance := GREATEST(plan.daily_free_credits - (w.daily_free_used + free_take), 0)
               + (w.monthly_credits_remaining - grant_take)
               + (w.topup_credits_remaining - topup_take);

  IF free_take  > 0 THEN sources := sources || jsonb_build_array(jsonb_build_object('bucket','daily_free',   'amount', free_take)); END IF;
  IF grant_take > 0 THEN sources := sources || jsonb_build_array(jsonb_build_object('bucket','monthly_grant','amount', grant_take)); END IF;
  IF topup_take > 0 THEN sources := sources || jsonb_build_array(jsonb_build_object('bucket','topup',        'amount', topup_take)); END IF;

  INSERT INTO public.credit_ledger(user_id, delta, reason, balance_after, project_id, metadata)
  VALUES (_user_id, -_amount, _reason, new_balance, _project_id,
          _metadata || jsonb_build_object('sources', sources))
  RETURNING id INTO ledger_id;

  RETURN ledger_id;
END;
$function$;