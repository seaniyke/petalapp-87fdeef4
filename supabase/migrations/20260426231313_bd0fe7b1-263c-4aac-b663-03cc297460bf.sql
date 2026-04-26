-- =========================================================
-- Custom domain slots — one-time, 12-month-valid add-on
-- =========================================================

-- ---------- 1. billing_addons catalog ----------
CREATE TABLE public.billing_addons (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  description   text,
  price_cents   integer NOT NULL CHECK (price_cents >= 0),
  duration_days integer NOT NULL CHECK (duration_days > 0),
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Add-ons are viewable by everyone"
  ON public.billing_addons FOR SELECT USING (true);
CREATE POLICY "Admins can insert add-ons"
  ON public.billing_addons FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update add-ons"
  ON public.billing_addons FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete add-ons"
  ON public.billing_addons FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_billing_addons_updated_at
  BEFORE UPDATE ON public.billing_addons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed: $12 USD, 365 days
INSERT INTO public.billing_addons (code, name, description, price_cents, duration_days, sort_order)
VALUES (
  'domain_slot',
  'Custom domain (12 months)',
  'One custom domain connected to your project for 12 months.',
  1200,
  365,
  1
);

-- ---------- 2. Extend price overrides + paystack_transactions to support 'addon' ----------
ALTER TABLE public.billing_price_overrides
  DROP CONSTRAINT IF EXISTS billing_price_overrides_item_kind_check;
ALTER TABLE public.billing_price_overrides
  ADD CONSTRAINT billing_price_overrides_item_kind_check
  CHECK (item_kind IN ('plan','pack','addon'));

ALTER TABLE public.paystack_transactions
  DROP CONSTRAINT IF EXISTS paystack_transactions_purpose_check;
ALTER TABLE public.paystack_transactions
  ADD CONSTRAINT paystack_transactions_purpose_check
  CHECK (purpose IN ('plan','pack','addon'));

ALTER TABLE public.paystack_transactions
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- ---------- 3. domain_slots ----------
CREATE TABLE public.domain_slots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id            uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  addon_code            text NOT NULL REFERENCES public.billing_addons(code),
  paystack_reference    text NOT NULL UNIQUE,
  amount_minor          bigint NOT NULL CHECK (amount_minor >= 0),
  currency_code         text NOT NULL REFERENCES public.billing_currencies(code),
  environment           text NOT NULL DEFAULT 'test',
  purchased_at          timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  consumed_by_domain_id uuid REFERENCES public.project_domains(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_domain_slots_user        ON public.domain_slots(user_id);
CREATE INDEX idx_domain_slots_project     ON public.domain_slots(project_id);
CREATE INDEX idx_domain_slots_consumed_by ON public.domain_slots(consumed_by_domain_id);
CREATE INDEX idx_domain_slots_active
  ON public.domain_slots(project_id, expires_at)
  WHERE consumed_by_domain_id IS NULL;

ALTER TABLE public.domain_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own domain slots"
  ON public.domain_slots FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
-- No INSERT/UPDATE/DELETE policies — only the service role (RPCs / server) writes.

CREATE TRIGGER trg_domain_slots_updated_at
  BEFORE UPDATE ON public.domain_slots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 4. RPC: apply a paid domain slot ----------
CREATE OR REPLACE FUNCTION public.apply_paystack_domain_slot(
  _user_id       uuid,
  _project_id    uuid,
  _addon_code    text,
  _reference     text,
  _amount_minor  bigint,
  _currency_code text,
  _environment   text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _duration_days integer;
  _slot_id       uuid;
BEGIN
  -- Idempotency
  SELECT id INTO _slot_id FROM public.domain_slots WHERE paystack_reference = _reference;
  IF _slot_id IS NOT NULL THEN
    RETURN _slot_id;
  END IF;

  SELECT duration_days INTO _duration_days
  FROM public.billing_addons
  WHERE code = _addon_code AND is_active = true;
  IF _duration_days IS NULL THEN
    RAISE EXCEPTION 'Unknown or inactive addon: %', _addon_code;
  END IF;

  INSERT INTO public.domain_slots (
    user_id, project_id, addon_code, paystack_reference,
    amount_minor, currency_code, environment,
    purchased_at, expires_at
  )
  VALUES (
    _user_id, _project_id, _addon_code, _reference,
    _amount_minor, _currency_code, _environment,
    now(), now() + make_interval(days => _duration_days)
  )
  RETURNING id INTO _slot_id;

  RETURN _slot_id;
END;
$$;

-- ---------- 5. RPC: expire domain slots (deactivate linked domains) ----------
CREATE OR REPLACE FUNCTION public.expire_domain_slots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _slot RECORD;
BEGIN
  FOR _slot IN
    SELECT id, consumed_by_domain_id
    FROM public.domain_slots
    WHERE expires_at < now()
      AND consumed_by_domain_id IS NOT NULL
    FOR UPDATE
  LOOP
    UPDATE public.project_domains
    SET status        = 'offline',
        error_message = 'Domain slot expired — renew to reactivate',
        updated_at    = now()
    WHERE id = _slot.consumed_by_domain_id;

    UPDATE public.domain_slots
    SET consumed_by_domain_id = NULL,
        updated_at            = now()
    WHERE id = _slot.id;
  END LOOP;
END;
$$;

-- ---------- 6. Daily cron: expire domain slots ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('expire-domain-slots-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-domain-slots-daily');
    PERFORM cron.schedule(
      'expire-domain-slots-daily',
      '15 2 * * *',
      $cron$ SELECT public.expire_domain_slots(); $cron$
    );
  END IF;
END
$$;