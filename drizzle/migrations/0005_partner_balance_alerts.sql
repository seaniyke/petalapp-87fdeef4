CREATE TABLE public.balance_alerts (
  user_id uuid PRIMARY KEY,
  threshold numeric NOT NULL,
  alerted_at timestamptz,
  last_balance numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.balance_alerts TO service_role;

ALTER TABLE public.balance_alerts ENABLE ROW LEVEL SECURITY;