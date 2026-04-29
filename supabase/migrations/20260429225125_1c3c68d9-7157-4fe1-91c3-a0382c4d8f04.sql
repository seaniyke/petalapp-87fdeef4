-- Drop & recreate the status check to add the 'polling' lifecycle state.
ALTER TABLE public.purchased_domains
  DROP CONSTRAINT IF EXISTS purchased_domains_status_check;

ALTER TABLE public.purchased_domains
  ADD CONSTRAINT purchased_domains_status_check
  CHECK (status IN ('pending_payment', 'registering', 'polling', 'active', 'failed', 'expired'));

-- New columns for the Cloudflare Registrar async workflow.
ALTER TABLE public.purchased_domains
  ADD COLUMN IF NOT EXISTS cf_registration_id TEXT,
  ADD COLUMN IF NOT EXISTS cf_registration_resource_link TEXT,
  ADD COLUMN IF NOT EXISTS cf_state TEXT,
  ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier TEXT;

CREATE INDEX IF NOT EXISTS idx_purchased_domains_polling
  ON public.purchased_domains(status, last_polled_at)
  WHERE status IN ('registering', 'polling');