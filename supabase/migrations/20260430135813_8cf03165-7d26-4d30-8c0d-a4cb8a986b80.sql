-- 1. Plan catalog: per-currency Paystack plan codes + interval
ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS paystack_plan_code_ngn text,
  ADD COLUMN IF NOT EXISTS paystack_plan_code_ghs text,
  ADD COLUMN IF NOT EXISTS paystack_plan_code_kes text,
  ADD COLUMN IF NOT EXISTS paystack_plan_code_zar text,
  ADD COLUMN IF NOT EXISTS paystack_plan_code_usd text,
  ADD COLUMN IF NOT EXISTS paystack_interval text NOT NULL DEFAULT 'monthly';

-- 2. Subscriptions table: Paystack-specific columns
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paystack_subscription_code text,
  ADD COLUMN IF NOT EXISTS paystack_email_token text,
  ADD COLUMN IF NOT EXISTS paystack_customer_code text,
  ADD COLUMN IF NOT EXISTS paystack_authorization_code text,
  ADD COLUMN IF NOT EXISTS next_payment_date timestamptz,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';

-- Backfill provider for any pre-existing rows (idempotent)
UPDATE public.subscriptions SET provider = 'stripe' WHERE provider IS NULL;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_provider_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_provider_check CHECK (provider IN ('stripe','paystack'));

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_paystack_sub_code_uniq
  ON public.subscriptions (paystack_subscription_code)
  WHERE paystack_subscription_code IS NOT NULL;

-- 3. paystack_invoices: audit trail for every renewal invoice
CREATE TABLE IF NOT EXISTS public.paystack_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subscription_code text NOT NULL,
  invoice_code text NOT NULL UNIQUE,
  amount_minor bigint NOT NULL,
  currency_code text NOT NULL,
  status text NOT NULL,
  description text,
  paid_at timestamptz,
  paystack_reference text,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paystack_invoices_user_idx ON public.paystack_invoices(user_id);
CREATE INDEX IF NOT EXISTS paystack_invoices_sub_idx ON public.paystack_invoices(subscription_code);

ALTER TABLE public.paystack_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view their own paystack invoices" ON public.paystack_invoices;
CREATE POLICY "Users view their own paystack invoices"
ON public.paystack_invoices
FOR SELECT
USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

-- 4. Insert policies on subscriptions for service role (admin client) — RLS already
-- protects user reads. Service role bypasses RLS, so no extra grant needed.

-- 5. Helper RPC: cancel a Paystack-driven subscription locally (downgrade to free)
CREATE OR REPLACE FUNCTION public.cancel_paystack_plan(
  _user_id uuid,
  _subscription_code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mark the subscriptions row cancelled.
  UPDATE public.subscriptions
  SET status = 'cancelled',
      cancel_at_period_end = false,
      updated_at = now()
  WHERE paystack_subscription_code = _subscription_code;

  -- Downgrade the wallet to free, but keep current_period_end so the user
  -- finishes the period they paid for (no insta-revoke).
  UPDATE public.user_wallets
  SET plan_code = 'free',
      subscription_status = 'cancelled',
      pending_plan_code = NULL,
      pending_plan_change_at = NULL,
      updated_at = now()
  WHERE user_id = _user_id;
END;
$$;