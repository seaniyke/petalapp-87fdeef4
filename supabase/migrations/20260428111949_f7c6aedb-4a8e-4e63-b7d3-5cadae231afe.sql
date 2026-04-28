
-- ============================================================
-- 1. Runtime wallet columns on user_wallets
-- ============================================================
ALTER TABLE public.user_wallets
  ADD COLUMN IF NOT EXISTS runtime_free_balance_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS runtime_topup_balance_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS runtime_free_reset_at DATE NOT NULL DEFAULT (date_trunc('month', (now() AT TIME ZONE 'utc'))::date + INTERVAL '1 month')::date,
  ADD COLUMN IF NOT EXISTS workspace_cap_cents BIGINT;

-- ============================================================
-- 2. Per-project spend cap + pause flag
-- ============================================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS spend_cap_cents BIGINT,
  ADD COLUMN IF NOT EXISTS runtime_paused BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 3. Runtime ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS public.runtime_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID,
  meter TEXT NOT NULL, -- 'backend_hour' | 'image_gen' | 'app_ai' | 'domain' | 'topup' | 'free_grant' | 'admin_adjust'
  delta_cents BIGINT NOT NULL,
  free_after_cents BIGINT NOT NULL,
  topup_after_cents BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runtime_ledger_user_created
  ON public.runtime_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_ledger_project_created
  ON public.runtime_ledger (project_id, created_at DESC);

ALTER TABLE public.runtime_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view their own runtime ledger" ON public.runtime_ledger;
CREATE POLICY "Users view their own runtime ledger"
  ON public.runtime_ledger
  FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- 4. Runtime top-up packs (fixed presets)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.runtime_topup_packs (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,        -- USD cents value the user receives
  currency_code TEXT NOT NULL,         -- display currency (e.g. 'NGN')
  display_amount_minor BIGINT NOT NULL,-- amount in display currency minor units (e.g. kobo)
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.runtime_topup_packs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active runtime packs" ON public.runtime_topup_packs;
CREATE POLICY "Anyone can view active runtime packs"
  ON public.runtime_topup_packs
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can insert runtime packs" ON public.runtime_topup_packs;
CREATE POLICY "Admins can insert runtime packs"
  ON public.runtime_topup_packs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can update runtime packs" ON public.runtime_topup_packs;
CREATE POLICY "Admins can update runtime packs"
  ON public.runtime_topup_packs
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can delete runtime packs" ON public.runtime_topup_packs;
CREATE POLICY "Admins can delete runtime packs"
  ON public.runtime_topup_packs
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_runtime_topup_packs_updated_at
  BEFORE UPDATE ON public.runtime_topup_packs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 5. Atomic charge function (free first, then top-up, with cap enforcement)
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
  this_month      DATE := date_trunc('month', (now() AT TIME ZONE 'utc'))::date;
  free_take       BIGINT := 0;
  topup_take      BIGINT := 0;
  remaining       BIGINT;
  project_spent   BIGINT;
  workspace_spent BIGINT;
  proj_cap        BIGINT;
BEGIN
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN QUERY SELECT true, 'noop', 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_wallets(user_id) VALUES (_user_id) RETURNING * INTO w;
  END IF;

  -- Roll over free balance if past reset date
  IF w.runtime_free_reset_at <= (now() AT TIME ZONE 'utc')::date THEN
    UPDATE public.user_wallets
       SET runtime_free_balance_cents = 1000, -- $10 default monthly
           runtime_free_reset_at = (date_trunc('month', (now() AT TIME ZONE 'utc'))::date + INTERVAL '1 month')::date,
           updated_at = now()
     WHERE user_id = _user_id
     RETURNING * INTO w;
  END IF;

  -- Per-project cap check (month-to-date debits, in cents)
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

  -- Workspace cap check
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

  -- Insufficient funds?
  IF w.runtime_free_balance_cents + w.runtime_topup_balance_cents < _amount_cents THEN
    RETURN QUERY SELECT false, 'insufficient_balance', w.runtime_free_balance_cents, w.runtime_topup_balance_cents;
    RETURN;
  END IF;

  -- Drain free first
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
-- 6. Atomic credit function (top-up + monthly grant)
-- ============================================================
CREATE OR REPLACE FUNCTION public.credit_runtime(
  _user_id UUID,
  _meter TEXT,
  _amount_cents BIGINT,
  _bucket TEXT DEFAULT 'topup', -- 'topup' or 'free'
  _metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.user_wallets%ROWTYPE;
BEGIN
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN RETURN; END IF;

  INSERT INTO public.user_wallets(user_id) VALUES (_user_id)
    ON CONFLICT (user_id) DO NOTHING;

  IF _bucket = 'free' THEN
    UPDATE public.user_wallets
       SET runtime_free_balance_cents = runtime_free_balance_cents + _amount_cents,
           updated_at = now()
     WHERE user_id = _user_id
     RETURNING * INTO w;
  ELSE
    UPDATE public.user_wallets
       SET runtime_topup_balance_cents = runtime_topup_balance_cents + _amount_cents,
           updated_at = now()
     WHERE user_id = _user_id
     RETURNING * INTO w;
  END IF;

  INSERT INTO public.runtime_ledger(user_id, project_id, meter, delta_cents, free_after_cents, topup_after_cents, metadata)
  VALUES (_user_id, NULL, _meter, _amount_cents, w.runtime_free_balance_cents, w.runtime_topup_balance_cents, _metadata);
END;
$$;

-- ============================================================
-- 7. Paystack -> runtime top-up (idempotent on reference)
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
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.runtime_ledger
     WHERE meter = 'topup'
       AND metadata ->> 'paystack_reference' = _reference
  ) THEN
    RETURN;
  END IF;

  PERFORM public.credit_runtime(
    _user_id, 'topup', _amount_cents, 'topup',
    _metadata || jsonb_build_object('paystack_reference', _reference, 'provider', 'paystack')
  );
END;
$$;

-- ============================================================
-- 8. Monthly free grant (re-fills wallets that didn't auto-roll on charge)
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
     FOR UPDATE
  LOOP
    UPDATE public.user_wallets
       SET runtime_free_balance_cents = 1000, -- $10
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

-- ============================================================
-- 9. Schedule monthly grant job (1st of each month, 00:05 UTC)
-- ============================================================
DO $$
BEGIN
  PERFORM cron.unschedule('runtime-monthly-grant');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'runtime-monthly-grant',
  '5 0 1 * *',
  $$ SELECT public.runtime_apply_monthly_grant(); $$
);

-- ============================================================
-- 10. Seed default Naira top-up packs
-- ============================================================
INSERT INTO public.runtime_topup_packs (code, label, amount_cents, currency_code, display_amount_minor, sort_order)
VALUES
  ('runtime_starter',  '₦1,500',  100,  'NGN', 150000,  1),   -- ~$1
  ('runtime_standard', '₦5,000',  350,  'NGN', 500000,  2),   -- ~$3.50
  ('runtime_pro',      '₦20,000', 1500, 'NGN', 2000000, 3)    -- ~$15
ON CONFLICT (code) DO NOTHING;
