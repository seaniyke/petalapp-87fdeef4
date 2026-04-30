
-- Make legacy Stripe-only columns nullable so Paystack subscription rows can be inserted.
ALTER TABLE public.subscriptions ALTER COLUMN stripe_subscription_id DROP NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN price_id DROP NOT NULL;

-- Drop legacy unique constraint that disallows multiple NULLs only as a side
-- effect (Postgres allows multiple NULLs in UNIQUE, so this is safe to keep,
-- but we re-create it as a partial unique to make intent explicit).
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_stripe_subscription_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_uniq
  ON public.subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Add the unique constraint required for upsert on paystack_subscription_code.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_paystack_subscription_code_uniq
  ON public.subscriptions (paystack_subscription_code)
  WHERE paystack_subscription_code IS NOT NULL;
