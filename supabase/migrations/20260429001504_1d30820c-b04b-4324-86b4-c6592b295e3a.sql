-- ============================================================
-- Cloud-balance backend model: $5/mo free grant, $10 floor,
-- 48-hour grace period instead of immediate pause.
-- ============================================================

-- 1. Lower monthly free grant constant. Existing $10 balances on already-
--    qualified wallets are clamped down to $5 so we don't leave anyone with
--    a stale grant amount above the new ceiling.
UPDATE public.user_wallets
   SET runtime_free_balance_cents = LEAST(runtime_free_balance_cents, 500)
 WHERE runtime_topup_qualified_at IS NOT NULL;

-- 2. Grace period column on projects. NULL = no grace active.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS runtime_grace_until TIMESTAMPTZ;

-- 3. charge_runtime: drain free → topup, then on shortfall start a 48h
--    grace window on the project (instead of returning failure for a
--    well-funded project). Workspace cap & project spend-cap behaviour
--    unchanged.
CREATE OR REPLACE FUNCTION public.charge_runtime(
  _user_id      UUID,
  _project_id   UUID,
  _meter        TEXT,
  _amount_cents BIGINT,
  _metadata     JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (
  ok          BOOLEAN,
  reason      TEXT,
  free_after  BIGINT,
  topup_after BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w           public.user_wallets;
  remaining   BIGINT := _amount_cents;
  free_take   BIGINT := 0;
  topup_take  BIGINT := 0;
  proj_spent  BIGINT := 0;
  ws_spent    BIGINT := 0;
BEGIN
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
    RETURN QUERY SELECT true, 'noop', COALESCE(w.runtime_free_balance_cents,0), COALESCE(w.runtime_topup_balance_cents,0);
    RETURN;
  END IF;

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_wallets (user_id) VALUES (_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  END IF;

  -- Monthly rollover: only qualified wallets get the $5 free grant.
  IF w.runtime_topup_qualified_at IS NOT NULL
     AND (w.runtime_free_reset_at IS NULL OR w.runtime_free_reset_at <= CURRENT_DATE) THEN
    UPDATE public.user_wallets
       SET runtime_free_balance_cents = 500,
           runtime_free_reset_at = (date_trunc('month', now()) + interval '1 month')::date
     WHERE user_id = _user_id
    RETURNING * INTO w;
  END IF;

  -- Project spend cap.
  IF _project_id IS NOT NULL THEN
    SELECT COALESCE(SUM(ABS(delta_cents)),0) INTO proj_spent
      FROM public.runtime_ledger
     WHERE project_id = _project_id
       AND delta_cents < 0
       AND created_at >= date_trunc('month', now());
    IF EXISTS (
      SELECT 1 FROM public.projects
       WHERE id = _project_id
         AND spend_cap_cents IS NOT NULL
         AND proj_spent + _amount_cents > spend_cap_cents
    ) THEN
      UPDATE public.projects SET runtime_paused = true WHERE id = _project_id;
      RETURN QUERY SELECT false, 'project_cap_exceeded', w.runtime_free_balance_cents, w.runtime_topup_balance_cents;
      RETURN;
    END IF;
  END IF;

  -- Workspace cap.
  IF w.workspace_cap_cents IS NOT NULL THEN
    SELECT COALESCE(SUM(ABS(delta_cents)),0) INTO ws_spent
      FROM public.runtime_ledger
     WHERE user_id = _user_id
       AND delta_cents < 0
       AND created_at >= date_trunc('month', now());
    IF ws_spent + _amount_cents > w.workspace_cap_cents THEN
      RETURN QUERY SELECT false, 'workspace_cap_exceeded', w.runtime_free_balance_cents, w.runtime_topup_balance_cents;
      RETURN;
    END IF;
  END IF;

  -- Insufficient funds → start (or extend) 48h grace window on the project,
  -- record the attempted charge as zero (so it surfaces in usage), and
  -- return ok=false so the caller can decide whether to skip the work.
  IF w.runtime_free_balance_cents + w.runtime_topup_balance_cents < _amount_cents THEN
    IF _project_id IS NOT NULL THEN
      UPDATE public.projects
         SET runtime_grace_until = COALESCE(runtime_grace_until, now() + interval '48 hours')
       WHERE id = _project_id;
    END IF;
    RETURN QUERY SELECT false, 'insufficient_balance', w.runtime_free_balance_cents, w.runtime_topup_balance_cents;
    RETURN;
  END IF;

  -- Drain free first, then top-up.
  IF w.runtime_free_balance_cents > 0 THEN
    free_take := LEAST(w.runtime_free_balance_cents, remaining);
    remaining := remaining - free_take;
  END IF;
  IF remaining > 0 THEN
    topup_take := LEAST(w.runtime_topup_balance_cents, remaining);
    remaining := remaining - topup_take;
  END IF;

  UPDATE public.user_wallets
     SET runtime_free_balance_cents  = runtime_free_balance_cents  - free_take,
         runtime_topup_balance_cents = runtime_topup_balance_cents - topup_take,
         updated_at = now()
   WHERE user_id = _user_id
  RETURNING * INTO w;

  -- A successful charge clears any active grace window on the project.
  IF _project_id IS NOT NULL THEN
    UPDATE public.projects
       SET runtime_grace_until = NULL
     WHERE id = _project_id
       AND runtime_grace_until IS NOT NULL;
  END IF;

  INSERT INTO public.runtime_ledger
    (user_id, project_id, meter, delta_cents, free_balance_after, topup_balance_after, metadata)
  VALUES
    (_user_id, _project_id, _meter, -_amount_cents,
     w.runtime_free_balance_cents, w.runtime_topup_balance_cents, _metadata);

  RETURN QUERY SELECT true, 'ok', w.runtime_free_balance_cents, w.runtime_topup_balance_cents;
END;
$$;

-- 4. apply_paystack_runtime_topup: monthly free grant is now $5 (500¢).
--    Also clears any active grace windows on the user's projects.
CREATE OR REPLACE FUNCTION public.apply_paystack_runtime_topup(
  _user_id      UUID,
  _reference    TEXT,
  _amount_cents BIGINT,
  _metadata     JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _was_qualified BOOLEAN;
  _w             public.user_wallets;
BEGIN
  -- Idempotency: only credit once per Paystack reference.
  IF EXISTS (
    SELECT 1 FROM public.runtime_ledger
     WHERE meter = 'topup'
       AND metadata ->> 'paystack_reference' = _reference
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.user_wallets (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT runtime_topup_qualified_at IS NOT NULL INTO _was_qualified
    FROM public.user_wallets WHERE user_id = _user_id;

  -- Credit the top-up.
  UPDATE public.user_wallets
     SET runtime_topup_balance_cents = runtime_topup_balance_cents + _amount_cents,
         updated_at = now()
   WHERE user_id = _user_id
  RETURNING * INTO _w;

  -- First-time top-up → mark qualified and grant the $5 free balance.
  IF NOT _was_qualified THEN
    UPDATE public.user_wallets
       SET runtime_topup_qualified_at = now(),
           runtime_free_balance_cents = 500,
           runtime_free_reset_at = (date_trunc('month', now()) + interval '1 month')::date
     WHERE user_id = _user_id
    RETURNING * INTO _w;

    INSERT INTO public.runtime_ledger
      (user_id, project_id, meter, delta_cents, free_balance_after, topup_balance_after, metadata)
    SELECT _user_id, NULL, 'free_grant', 500,
           runtime_free_balance_cents, runtime_topup_balance_cents,
           jsonb_build_object('source','first_topup_grant')
      FROM public.user_wallets WHERE user_id = _user_id;
  END IF;

  -- Record the top-up itself.
  INSERT INTO public.runtime_ledger
    (user_id, project_id, meter, delta_cents, free_balance_after, topup_balance_after, metadata)
  VALUES
    (_user_id, NULL, 'topup', _amount_cents,
     _w.runtime_free_balance_cents, _w.runtime_topup_balance_cents,
     _metadata || jsonb_build_object('paystack_reference', _reference));

  -- Top-up clears any active grace windows on this user's projects.
  UPDATE public.projects
     SET runtime_grace_until = NULL,
         runtime_paused = false
   WHERE owner_id = _user_id
     AND (runtime_grace_until IS NOT NULL OR runtime_paused = true);
END;
$$;

-- 5. Helper: enable a managed backend from Cloud balance.
--    Owner-side guard. Requires top-up balance >= $10 ($1000¢).
CREATE OR REPLACE FUNCTION public.can_enable_managed_backend(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(runtime_topup_balance_cents, 0) >= 1000
    FROM public.user_wallets WHERE user_id = _user_id;
$$;