CREATE TABLE public.crypto_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reference text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('plan','pack','runtime_topup')),
  item_code text NOT NULL,
  usd_amount_cents integer NOT NULL CHECK (usd_amount_cents > 0),
  asset text NOT NULL,
  chain text NOT NULL,
  wallet_address text NOT NULL,
  tx_hash text NOT NULL,
  amount_sent numeric(24,8),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  admin_note text,
  environment text NOT NULL DEFAULT 'live',
  reviewed_by uuid,
  reviewed_at timestamptz,
  credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crypto_payments_user_idx ON public.crypto_payments (user_id, created_at DESC);
CREATE INDEX crypto_payments_status_idx ON public.crypto_payments (status, created_at DESC);

GRANT SELECT, INSERT ON public.crypto_payments TO authenticated;
GRANT ALL ON public.crypto_payments TO service_role;

ALTER TABLE public.crypto_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own crypto payments"
  ON public.crypto_payments FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users submit their own crypto payments"
  ON public.crypto_payments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');