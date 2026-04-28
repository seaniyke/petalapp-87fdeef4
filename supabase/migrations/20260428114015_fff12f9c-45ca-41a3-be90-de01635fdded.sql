-- ============================================================
-- Runtime wallet: gate the $10/mo free gift behind a paid top-up.
-- A user only starts receiving the monthly free grant AFTER they
-- have made at least one successful runtime top-up.
-- ============================================================

-- 1. Track when the user first qualified (= first paid top-up)
ALTER TABLE public.user_wallets
  ADD COLUMN IF NOT EXISTS runtime_topup_qualified_at TIMESTAMPTZ;

-- 2. Backfill: anyone who already has a topup ledger entry counts as qualified
UPDATE public.user_wallets w
   SET runtime_topup_qualified_at = sub.first_topup_at
  FROM (
    SELECT user_id, MIN(created_at) AS first_topup_at
      FROM public.runtime_ledger
     WHERE meter = 'topup'
     GROUP BY user_id
  ) sub
 WHERE sub.user_id = w.user_id
   AND w.runtime_topup_qualified_at IS NULL;

-- 3. Reset everyone else's free balance to 0 (no gift until they pay)
UPDATE public.user_wallets
   SET runtime_free_balance_cents = 0,
       updated_at = now()
 WHERE runtime_topup_qualified_at IS NULL
   AND runtime_free_balance_cents > 0;

-- ============================================================
-- 4. charge_runtime: only auto-rollover the $10 gift for qualified users
-- ============================================================
CREATE OR REPLACE FUNCTION public.charge_runtime(
  _user_id UUID,
  _project_id UUID,
  _meter TEXT,
  _amount_cents BIGINT,
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(ok BOOLEAN, reason TEXT, free_after BIGINT, topup_after BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w               public.user_wallets%ROWTYPE;
  proj_cap        BIGINT;
  project_spent   BIGINT;
  workspace_spent BIGINT;
  remaining       BIGINT;
  free_take       BIGINT := 0;
  topup_take      BIGINT := 0;
BEGIN
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN QUERY SELECT true, 'noop', 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_wallets(user_id) VALUES (_user_id) RETURNING * INTO w;
  END IF;

  -- Roll over free balance ONLY if user has qualified (paid at least once)
  IF w.runtime_topup_qualified_at IS NOT NULL
     AND w.runtime_free_reset_at <= (now() AT TIME ZONE 'utc')::date THEN
    UPDATE public.user_wallets
       SET runtime_free_balance_cents = 1000,
           runtime_free_reset_at = (date_trunc('month', (now() AT TIME ZONE 'utc'))::date + INTERVAL '1 month')::date,
           updated_at = now()
     WHERE user_id = _user_id
     RETURNING * INTO w;
  END IF;

  -- Per-project cap
  IF _project_id IS NOT NULL THEN
    SELECT spend_cap_cents INTO proj_cap FROM public.projects WHERE id = _project_id;
    IF proj_cap IS NOT NULL THEN
      SELECT COALESCE(SUM(-delta_cents), 0) INTO project_spent
        FROM public.runtime_ledger
       WHERE project_id = _project_id
         AND delta_cents < 0
         AND created_at >= date_trunc('month', now());
      IF project_spent + _amount_cents > proj_cap THEN
        UPDATE public.projects SET runtime_paused = true WHERE id = _project_id;
        RETURN QUERY SELECT false, 'project_cap_exceeded', w.runtime_free_balance_cents, w.runtime_topup_balance_cents;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- Workspace cap
  IF w.workspace_cap_cents IS NOT NULL THEN
    SELECT COALESCE(SUM(-delta_cents), 0) INTO workspace_spent
      FROM public.runtime_ledger
     WHERE user_id = _user_id
       AND delta_cents < 0
       AND created_at >= date_trunc('month', now());
    IF workspace_spent + _amount_cents > w.workspace_cap_cents THEN
      RETURN QUERY SELECT false, 'workspace_cap_exceeded', w.runtime_free_balance_cents, w.runtime_topup_balance_cents;
      RETURN;
    END IF;
  END IF;

  IF w.runtime_free_balance_cents + w.runtime_topup_balance_cents < _amount_cents THEN
    RETURN QUERY SELECT false, 'insufficient_balance', w.runtime_free_balance_cents, w.runtime_topup_balance_cents;
    RETURN;
  END IF;

  remaining := _amount_cents;
  IF w.runtime_free_balance_cents > 0 THEN
    free_take := LEAST(w.runtime_free_balance_cents, remaining);
    remaining := remaining - free_take;
  END IF;
  IF remaining > 0 THEN
    topup_take := LEAST(w.runtime_topup_balance_cents, remaining);
    remaining := remaining - topup_take;
  END IF;

  UPDATE public.user_wallets
     SET runtime_free_balance_cents = runtime_free_balance_cents - free_take,
         runtime_topup_balance_cents = runtime_topup_balance_cents - topup_take,
         updated_at = now()
   WHERE user_id = _user_id
   RETURNING * INTO w;

  INSERT INTO public.runtime_ledger(user_id, project_id, meter, delta_cents, free_after_cents, topup_after_cents, metadata)
  VALUES (_user_id, _project_id, _meter, -_amount_cents, w.runtime_free_balance_cents, w.runtime_topup_balance_cents,
          _metadata || jsonb_build_object('free_take', free_take, 'topup_take', topup_take));

  RETURN QUERY SELECT true, 'ok', w.runtime_free_balance_cents, w.runtime_topup_balance_cents;
END;
$$;

-- ============================================================
-- 5. apply_paystack_runtime_topup: on FIRST paid top-up,
--    mark qualified and immediately grant the first $10 free.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_paystack_runtime_topup(
  _user_id UUID,
  _reference TEXT,
  _amount_cents BIGINT,
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _was_qualified BOOLEAN;
  _next_reset DATE := (date_trunc('month', (now() AT TIME ZONE 'utc'))::date + INTERVAL '1 month')::date;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.runtime_ledger
     WHERE meter = 'topup'
       AND metadata ->> 'paystack_reference' = _reference
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.user_wallets(user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;

  SELECT runtime_topup_qualified_at IS NOT NULL INTO _was_qualified
    FROM public.user_wallets WHERE user_id = _user_id;

  -- Credit the paid top-up
  PERFORM public.credit_runtime(
    _user_id, 'topup', _amount_cents, 'topup',
    _metadata || jsonb_build_object('paystack_reference', _reference, 'provider', 'paystack')
  );

  -- First-time qualification: stamp + immediate $10 gift
  IF NOT _was_qualified THEN
    UPDATE public.user_wallets
       SET runtime_topup_qualified_at = now(),
           runtime_free_balance_cents = 1000,
           runtime_free_reset_at = _next_reset,
           updated_at = now()
     WHERE user_id = _user_id;

    INSERT INTO public.runtime_ledger(user_id, project_id, meter, delta_cents, free_after_cents, topup_after_cents, metadata)
    SELECT _user_id, NULL, 'free_grant', 1000, runtime_free_balance_cents, runtime_topup_balance_cents,
           jsonb_build_object('reason', 'first_topup_qualification', 'reset_at', _next_reset)
      FROM public.user_wallets WHERE user_id = _user_id;
  END IF;
END;
$$;

-- ============================================================
-- 6. Monthly grant: only re-fill QUALIFIED wallets
-- ============================================================
CREATE OR REPLACE FUNCTION public.runtime_apply_monthly_grant()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _w RECORD;
  _today DATE := (now() AT TIME ZONE 'utc')::date;
  _next_reset DATE := (date_trunc('month', (now() AT TIME ZONE 'utc'))::date + INTERVAL '1 month')::date;
BEGIN
  FOR _w IN
    SELECT user_id FROM public.user_wallets
     WHERE runtime_free_reset_at <= _today
       AND runtime_topup_qualified_at IS NOT NULL
     FOR UPDATE
  LOOP
    UPDATE public.user_wallets
       SET runtime_free_balance_cents = 1000,
           runtime_free_reset_at = _next_reset,
           updated_at = now()
     WHERE user_id = _w.user_id;

    INSERT INTO public.runtime_ledger(user_id, project_id, meter, delta_cents, free_after_cents, topup_after_cents, metadata)
    SELECT _w.user_id, NULL, 'free_grant', 1000, runtime_free_balance_cents, runtime_topup_balance_cents,
           jsonb_build_object('reset_at', _next_reset)
      FROM public.user_wallets WHERE user_id = _w.user_id;
  END LOOP;
END;
$$;