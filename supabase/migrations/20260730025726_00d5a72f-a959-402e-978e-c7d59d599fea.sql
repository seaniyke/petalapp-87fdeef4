ALTER TABLE public.crypto_payments
  ADD COLUMN IF NOT EXISTS verify_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmations integer,
  ADD COLUMN IF NOT EXISTS detected_usd_cents integer,
  ADD COLUMN IF NOT EXISTS verify_note text,
  ADD COLUMN IF NOT EXISTS receipt_email_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS crypto_payments_pending_idx
  ON public.crypto_payments (status, last_checked_at NULLS FIRST);

ALTER TABLE public.crypto_payments REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'crypto_payments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.crypto_payments';
  END IF;
END $$;