
CREATE TABLE public.coffee_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  supporter_name text,
  supporter_email text NOT NULL,
  message text,
  amount_minor bigint NOT NULL,
  currency_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  paid_at timestamptz,
  environment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.coffee_tips TO service_role;
ALTER TABLE public.coffee_tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coffee_tips admin read"
  ON public.coffee_tips
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.invest_pledges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  amount_usd_intended integer,
  note text,
  contact_pref text,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.invest_pledges TO service_role;
ALTER TABLE public.invest_pledges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invest_pledges admin read"
  ON public.invest_pledges
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX invest_pledges_email_idx ON public.invest_pledges (email);
CREATE INDEX invest_pledges_created_idx ON public.invest_pledges (created_at DESC);
CREATE INDEX coffee_tips_status_idx ON public.coffee_tips (status);
