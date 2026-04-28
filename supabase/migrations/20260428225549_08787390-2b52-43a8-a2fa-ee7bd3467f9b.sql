-- Petal Email subscriptions: one per project
CREATE TABLE public.petal_email_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','canceled')),
  monthly_cap integer NOT NULL DEFAULT 3000,
  daily_cap integer NOT NULL DEFAULT 100,
  sender_email text NOT NULL DEFAULT 'noreply@buildwithpetal.com',
  reply_to text,
  custom_domain text,
  custom_domain_verified boolean NOT NULL DEFAULT false,
  resend_domain_id text,
  api_token_hash text NOT NULL,
  api_token_prefix text NOT NULL,
  paystack_reference text,
  current_period_start timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  current_period_end timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_petal_email_subs_user ON public.petal_email_subscriptions(user_id);
CREATE INDEX idx_petal_email_subs_token_prefix ON public.petal_email_subscriptions(api_token_prefix);

ALTER TABLE public.petal_email_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their petal email subscription"
ON public.petal_email_subscriptions FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = petal_email_subscriptions.project_id AND (p.owner_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)))
);

-- Daily usage aggregate
CREATE TABLE public.petal_email_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  usage_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, usage_date)
);

CREATE INDEX idx_petal_email_usage_project_date ON public.petal_email_usage(project_id, usage_date DESC);

ALTER TABLE public.petal_email_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their petal email usage"
ON public.petal_email_usage FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = petal_email_usage.project_id AND (p.owner_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)))
);

-- Outbound log
CREATE TABLE public.petal_email_outbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  recipient_email text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','suppressed','bounced','complained')),
  resend_message_id text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_petal_email_outbound_project ON public.petal_email_outbound(project_id, created_at DESC);

ALTER TABLE public.petal_email_outbound ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their petal email outbound log"
ON public.petal_email_outbound FOR SELECT
USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = petal_email_outbound.project_id AND (p.owner_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)))
);

-- updated_at triggers
CREATE TRIGGER trg_petal_email_subs_updated
BEFORE UPDATE ON public.petal_email_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_petal_email_usage_updated
BEFORE UPDATE ON public.petal_email_usage
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add 'petal_email' to allowed paystack purposes (best-effort; ignore if no constraint)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paystack_transactions_purpose_check'
  ) THEN
    ALTER TABLE public.paystack_transactions DROP CONSTRAINT paystack_transactions_purpose_check;
  END IF;
END $$;