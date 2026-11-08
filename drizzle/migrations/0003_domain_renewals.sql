ALTER TABLE public.purchased_domains
  ADD COLUMN IF NOT EXISTS term_years integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS renewal_status text,
  ADD COLUMN IF NOT EXISTS renewal_error text,
  ADD COLUMN IF NOT EXISTS last_renewed_at timestamptz;

CREATE TABLE public.domain_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchased_domain_id uuid NOT NULL REFERENCES public.purchased_domains(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  payer text NOT NULL,
  trigger text NOT NULL,
  years integer NOT NULL,
  prior_expires_at timestamptz,
  new_expires_at timestamptz,
  wholesale_cents integer,
  charged_cents integer,
  credits integer,
  credit_ledger_id uuid,
  status text NOT NULL,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.domain_renewals TO authenticated;
GRANT ALL ON public.domain_renewals TO service_role;

ALTER TABLE public.domain_renewals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their domain renewals"
ON public.domain_renewals FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.purchased_domains d
  WHERE d.id = domain_renewals.purchased_domain_id AND d.user_id = auth.uid()
));

CREATE INDEX idx_domain_renewals_domain ON public.domain_renewals(purchased_domain_id, created_at DESC);
-- One successful renewal per expiry date: a second run can never renew (and charge) twice.
CREATE UNIQUE INDEX uq_domain_renewals_once_per_expiry
  ON public.domain_renewals(purchased_domain_id, prior_expires_at)
  WHERE status = 'succeeded';
CREATE INDEX idx_purchased_domains_renewal_due
  ON public.purchased_domains(expires_at) WHERE status = 'active' AND auto_renew = true;