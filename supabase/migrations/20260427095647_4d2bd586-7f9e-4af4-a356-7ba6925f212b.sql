-- 1. Extend project_backends with managed-backend fields
ALTER TABLE public.project_backends
  ADD COLUMN IF NOT EXISTS supabase_project_ref text,
  ADD COLUMN IF NOT EXISTS provisioning_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz;

-- 2. Create backend_slots table (mirrors domain_slots shape)
CREATE TABLE IF NOT EXISTS public.backend_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  addon_code text NOT NULL,
  paystack_reference text NOT NULL UNIQUE,
  amount_minor bigint NOT NULL,
  currency_code text NOT NULL,
  environment text NOT NULL DEFAULT 'test',
  purchased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_by_backend_id uuid,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backend_slots_user_idx ON public.backend_slots(user_id);
CREATE INDEX IF NOT EXISTS backend_slots_project_idx ON public.backend_slots(project_id);
CREATE INDEX IF NOT EXISTS backend_slots_expires_idx ON public.backend_slots(expires_at) WHERE status = 'active';

ALTER TABLE public.backend_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own backend slots"
  ON public.backend_slots
  FOR SELECT
  USING ((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::app_role));

-- updated_at trigger
DROP TRIGGER IF EXISTS backend_slots_updated_at ON public.backend_slots;
CREATE TRIGGER backend_slots_updated_at
  BEFORE UPDATE ON public.backend_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Seed the new add-on in the catalog
INSERT INTO public.billing_addons (code, name, description, price_cents, duration_days, sort_order, is_active)
VALUES (
  'managed_backend_monthly',
  'Managed backend (30 days)',
  'Petal provisions a dedicated Supabase backend for this project. Renews every 30 days.',
  1500,
  30,
  10,
  true
)
ON CONFLICT (code) DO NOTHING;

-- 4. RPC: apply_paystack_backend_slot — runs on successful Paystack payment.
CREATE OR REPLACE FUNCTION public.apply_paystack_backend_slot(
  _user_id uuid,
  _project_id uuid,
  _addon_code text,
  _reference text,
  _amount_minor bigint,
  _currency_code text,
  _environment text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _duration_days integer;
  _slot_id uuid;
BEGIN
  -- Idempotency: if we already processed this Paystack reference, return its slot.
  SELECT id INTO _slot_id FROM public.backend_slots WHERE paystack_reference = _reference;
  IF _slot_id IS NOT NULL THEN
    RETURN _slot_id;
  END IF;

  SELECT duration_days INTO _duration_days
    FROM public.billing_addons
    WHERE code = _addon_code AND is_active = true;
  IF _duration_days IS NULL THEN
    RAISE EXCEPTION 'Unknown or inactive addon: %', _addon_code;
  END IF;

  INSERT INTO public.backend_slots (
    user_id, project_id, addon_code, paystack_reference,
    amount_minor, currency_code, environment,
    purchased_at, expires_at, status
  ) VALUES (
    _user_id, _project_id, _addon_code, _reference,
    _amount_minor, _currency_code, _environment,
    now(), now() + make_interval(days => _duration_days), 'active'
  )
  RETURNING id INTO _slot_id;

  -- Upsert the project_backends row in 'provisioning' state. The actual
  -- Supabase project creation happens in the application server after this
  -- RPC returns (it needs network access).
  INSERT INTO public.project_backends (
    project_id, provider, status, supabase_url, anon_key,
    provisioning_started_at, paused_at, error_message
  ) VALUES (
    _project_id, 'managed_petal', 'provisioning', '', '',
    now(), NULL, NULL
  )
  ON CONFLICT (project_id) DO UPDATE SET
    provider = 'managed_petal',
    status = CASE
      WHEN public.project_backends.status = 'paused' THEN 'ready'
      WHEN public.project_backends.supabase_url <> '' THEN public.project_backends.status
      ELSE 'provisioning'
    END,
    paused_at = NULL,
    provisioning_started_at = COALESCE(public.project_backends.provisioning_started_at, now()),
    error_message = NULL;

  RETURN _slot_id;
END;
$$;

-- 5. RPC: expire_backend_slots — daily housekeeping.
CREATE OR REPLACE FUNCTION public.expire_backend_slots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _slot RECORD;
BEGIN
  FOR _slot IN
    SELECT bs.id, bs.project_id
      FROM public.backend_slots bs
     WHERE bs.status = 'active'
       AND bs.expires_at < now()
       AND NOT EXISTS (
         SELECT 1 FROM public.backend_slots bs2
          WHERE bs2.project_id = bs.project_id
            AND bs2.status = 'active'
            AND bs2.id <> bs.id
            AND bs2.expires_at >= now()
       )
     FOR UPDATE OF bs
  LOOP
    UPDATE public.backend_slots SET status = 'expired', updated_at = now()
      WHERE id = _slot.id;

    UPDATE public.project_backends
       SET status = 'paused',
           paused_at = now(),
           error_message = 'Backend slot expired — renew to reactivate.'
     WHERE project_id = _slot.project_id
       AND provider = 'managed_petal'
       AND status <> 'paused';
  END LOOP;
END;
$$;