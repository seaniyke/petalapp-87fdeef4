
-- 1) New table for tracking domains purchased through Petal's registrar.
CREATE TABLE public.purchased_domains (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  -- wholesale cost in USD cents (what Cloudflare charges us)
  wholesale_cost_cents INTEGER NOT NULL,
  -- price the user paid in USD cents (cost * 1.25, rounded)
  charged_cents INTEGER NOT NULL,
  -- price in user's chosen currency (kobo, etc.) for receipts
  charged_minor BIGINT NOT NULL,
  currency_code TEXT NOT NULL,
  -- lifecycle
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'registering', 'active', 'failed', 'expired')),
  error_message TEXT,
  -- registrar metadata
  registered_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  auto_renew BOOLEAN NOT NULL DEFAULT true,
  -- link back to the Paystack transaction that paid for it
  paystack_reference TEXT,
  -- link to the project_domains row created when we connect it
  connected_domain_id UUID REFERENCES public.project_domains(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchased_domains_project ON public.purchased_domains(project_id);
CREATE INDEX idx_purchased_domains_user ON public.purchased_domains(user_id);
CREATE INDEX idx_purchased_domains_status ON public.purchased_domains(status);
CREATE INDEX idx_purchased_domains_paystack_ref ON public.purchased_domains(paystack_reference);

-- 2) RLS
ALTER TABLE public.purchased_domains ENABLE ROW LEVEL SECURITY;

-- Owners can view their projects' purchased domains.
CREATE POLICY "Owners view purchased domains"
ON public.purchased_domains
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = purchased_domains.project_id
      AND p.owner_id = auth.uid()
  )
);

-- No client-side INSERT/UPDATE/DELETE — only service role (server) writes.

-- 3) updated_at trigger
CREATE TRIGGER update_purchased_domains_updated_at
BEFORE UPDATE ON public.purchased_domains
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Allow `domain_purchase` as a paystack_transactions purpose.
ALTER TABLE public.paystack_transactions
DROP CONSTRAINT IF EXISTS paystack_transactions_purpose_check;

ALTER TABLE public.paystack_transactions
ADD CONSTRAINT paystack_transactions_purpose_check
CHECK (purpose IN ('plan', 'pack', 'addon', 'runtime_topup', 'domain_purchase'));
