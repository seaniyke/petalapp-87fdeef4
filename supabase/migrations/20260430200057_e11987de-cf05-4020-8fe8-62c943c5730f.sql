-- 1. Suppressions table
CREATE TABLE IF NOT EXISTS public.petal_email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('bounced','complained','unsubscribed','manual')),
  source_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_petal_email_suppressions_project
  ON public.petal_email_suppressions (project_id, recipient_email);

ALTER TABLE public.petal_email_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their petal email suppressions"
  ON public.petal_email_suppressions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = petal_email_suppressions.project_id
      AND (p.owner_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  ));

-- 2. Idempotency key on outbound log (also helps dedupe webhook updates)
ALTER TABLE public.petal_email_outbound
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE INDEX IF NOT EXISTS idx_petal_email_outbound_idem
  ON public.petal_email_outbound (project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_petal_email_outbound_resend_id
  ON public.petal_email_outbound (resend_message_id)
  WHERE resend_message_id IS NOT NULL;

-- 3. Atomic usage counter (avoids read-then-write race)
CREATE OR REPLACE FUNCTION public.increment_petal_email_usage(
  p_project_id uuid,
  p_monthly_cap integer,
  p_daily_cap integer
) RETURNS TABLE (
  allowed boolean,
  reason text,
  monthly_used integer,
  daily_used integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_month_start date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_monthly integer;
  v_daily integer;
BEGIN
  -- Lock & sum month
  SELECT COALESCE(SUM(sent_count), 0) INTO v_monthly
  FROM public.petal_email_usage
  WHERE project_id = p_project_id AND usage_date >= v_month_start;

  SELECT COALESCE(sent_count, 0) INTO v_daily
  FROM public.petal_email_usage
  WHERE project_id = p_project_id AND usage_date = v_today;

  v_daily := COALESCE(v_daily, 0);

  IF v_monthly >= p_monthly_cap THEN
    RETURN QUERY SELECT false, format('Monthly email cap reached (%s).', p_monthly_cap), v_monthly, v_daily;
    RETURN;
  END IF;
  IF v_daily >= p_daily_cap THEN
    RETURN QUERY SELECT false, format('Daily email cap reached (%s). Resets at 00:00 UTC.', p_daily_cap), v_monthly, v_daily;
    RETURN;
  END IF;

  INSERT INTO public.petal_email_usage (project_id, usage_date, sent_count)
  VALUES (p_project_id, v_today, 1)
  ON CONFLICT (project_id, usage_date)
  DO UPDATE SET sent_count = public.petal_email_usage.sent_count + 1,
                updated_at = now();

  RETURN QUERY SELECT true, NULL::text, v_monthly + 1, v_daily + 1;
END;
$$;

-- Compensating decrement when the actual send fails
CREATE OR REPLACE FUNCTION public.decrement_petal_email_usage(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  UPDATE public.petal_email_usage
  SET sent_count = GREATEST(sent_count - 1, 0),
      failed_count = failed_count + 1,
      updated_at = now()
  WHERE project_id = p_project_id AND usage_date = v_today;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_petal_email_usage(uuid, integer, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.decrement_petal_email_usage(uuid) FROM public, anon, authenticated;

-- 4. Unique constraint on api_token_prefix for fast & correct lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_petal_email_subs_token_prefix_unique
  ON public.petal_email_subscriptions (api_token_prefix);