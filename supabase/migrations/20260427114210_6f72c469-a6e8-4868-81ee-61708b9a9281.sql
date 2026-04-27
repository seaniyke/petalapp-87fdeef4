-- ============================================================
-- 1. Widen credit columns from int to numeric(10,2)
-- ============================================================

ALTER TABLE public.user_wallets
  ALTER COLUMN monthly_credits_remaining TYPE numeric(10,2) USING monthly_credits_remaining::numeric,
  ALTER COLUMN topup_credits_remaining   TYPE numeric(10,2) USING topup_credits_remaining::numeric,
  ALTER COLUMN daily_free_used           TYPE numeric(10,2) USING daily_free_used::numeric,
  ALTER COLUMN monthly_free_used         TYPE numeric(10,2) USING monthly_free_used::numeric;

ALTER TABLE public.user_wallets
  ALTER COLUMN monthly_credits_remaining SET DEFAULT 0,
  ALTER COLUMN topup_credits_remaining   SET DEFAULT 0,
  ALTER COLUMN daily_free_used           SET DEFAULT 0,
  ALTER COLUMN monthly_free_used         SET DEFAULT 0;

ALTER TABLE public.credit_ledger
  ALTER COLUMN delta         TYPE numeric(10,2) USING delta::numeric,
  ALTER COLUMN balance_after TYPE numeric(10,2) USING balance_after::numeric;

ALTER TABLE public.credit_packs
  ALTER COLUMN credits TYPE numeric(10,2) USING credits::numeric;

ALTER TABLE public.topup_lots
  ALTER COLUMN credits_granted   TYPE numeric(10,2) USING credits_granted::numeric,
  ALTER COLUMN credits_remaining TYPE numeric(10,2) USING credits_remaining::numeric;

-- ============================================================
-- 2. Drop existing spend_credit / refund_credit (signature change)
-- ============================================================

DROP FUNCTION IF EXISTS public.spend_credit(uuid, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.refund_credit(uuid, text, uuid, jsonb);

-- ============================================================
-- 3. New spend_credit with explicit numeric amount
--    Returns the ledger row id (uuid) on success, NULL when out of credits.
-- ============================================================

CREATE OR REPLACE FUNCTION public.spend_credit(
  _user_id uuid,
  _amount  numeric,
  _reason  text   DEFAULT 'ai_message',
  _project_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  w           public.user_wallets%ROWTYPE;
  plan        public.billing_plans%ROWTYPE;
  today       date := (now() AT TIME ZONE 'utc')::date;
  this_month  date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
  ledger_id   uuid;

  daily_avail   numeric(10,2);
  monthly_cap_avail numeric(10,2);
  free_avail    numeric(10,2);
  free_take     numeric(10,2) := 0;
  grant_take    numeric(10,2) := 0;
  topup_take    numeric(10,2) := 0;
  remaining     numeric(10,2);
  total_avail   numeric(10,2);
  new_balance   numeric(10,2);
  sources       jsonb := '[]'::jsonb;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0 (got %)', _amount;
  END IF;

  -- Round to 2dp upfront so arithmetic stays clean
  _amount := round(_amount, 2);

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_wallets(user_id) VALUES (_user_id)
    RETURNING * INTO w;
  END IF;

  SELECT * INTO plan FROM public.billing_plans WHERE code = w.plan_code;

  -- Refill daily/monthly free buckets on rollover
  IF w.daily_free_reset_at < today THEN
    w.daily_free_used := 0;
    w.daily_free_reset_at := today;
  END IF;
  IF w.monthly_free_reset_at < this_month THEN
    w.monthly_free_used := 0;
    w.monthly_free_reset_at := this_month;
  END IF;

  -- Compute available in each bucket (free is the smaller of daily-left and monthly-cap-left)
  daily_avail := GREATEST(plan.daily_free_credits - w.daily_free_used, 0);
  IF plan.monthly_free_cap IS NULL THEN
    monthly_cap_avail := daily_avail; -- effectively unlimited monthly cap
  ELSE
    monthly_cap_avail := GREATEST(plan.monthly_free_cap - w.monthly_free_used, 0);
  END IF;
  free_avail := LEAST(daily_avail, monthly_cap_avail);

  total_avail := free_avail + w.monthly_credits_remaining + w.topup_credits_remaining;
  IF total_avail < _amount THEN
    RETURN NULL;
  END IF;

  remaining := _amount;

  -- 1) Take from free first
  IF remaining > 0 AND free_avail > 0 THEN
    free_take := LEAST(free_avail, remaining);
    remaining := remaining - free_take;
  END IF;

  -- 2) Then monthly grant
  IF remaining > 0 AND w.monthly_credits_remaining > 0 THEN
    grant_take := LEAST(w.monthly_credits_remaining, remaining);
    remaining := remaining - grant_take;
  END IF;

  -- 3) Then topup
  IF remaining > 0 AND w.topup_credits_remaining > 0 THEN
    topup_take := LEAST(w.topup_credits_remaining, remaining);
    remaining := remaining - topup_take;
  END IF;

  -- Should not happen given the total_avail check above
  IF remaining > 0 THEN
    RETURN NULL;
  END IF;

  -- Apply the deductions
  UPDATE public.user_wallets
     SET daily_free_used           = w.daily_free_used + free_take,
         daily_free_reset_at       = w.daily_free_reset_at,
         monthly_free_used         = w.monthly_free_used + free_take,
         monthly_free_reset_at     = w.monthly_free_reset_at,
         monthly_credits_remaining = w.monthly_credits_remaining - grant_take,
         topup_credits_remaining   = w.topup_credits_remaining - topup_take,
         updated_at                = now()
   WHERE user_id = _user_id;

  -- New balance for ledger snapshot
  new_balance := GREATEST(plan.daily_free_credits - (w.daily_free_used + free_take), 0)
               + (w.monthly_credits_remaining - grant_take)
               + (w.topup_credits_remaining - topup_take);

  -- Build sources breakdown
  IF free_take  > 0 THEN sources := sources || jsonb_build_array(jsonb_build_object('bucket','daily_free',   'amount', free_take)); END IF;
  IF grant_take > 0 THEN sources := sources || jsonb_build_array(jsonb_build_object('bucket','monthly_grant','amount', grant_take)); END IF;
  IF topup_take > 0 THEN sources := sources || jsonb_build_array(jsonb_build_object('bucket','topup',        'amount', topup_take)); END IF;

  INSERT INTO public.credit_ledger(user_id, delta, reason, balance_after, project_id, metadata)
  VALUES (_user_id, -_amount, _reason, new_balance, _project_id,
          _metadata || jsonb_build_object('sources', sources))
  RETURNING id INTO ledger_id;

  RETURN ledger_id;
END;
$function$;

-- Backward-compatible 1-credit wrapper so any old call site keeps working.
-- Returns boolean (true on success) like the previous version.
CREATE OR REPLACE FUNCTION public.spend_credit(
  _user_id uuid,
  _reason  text   DEFAULT 'ai_message',
  _project_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ledger_id uuid;
BEGIN
  ledger_id := public.spend_credit(_user_id, 1.00::numeric, _reason, _project_id, _metadata);
  RETURN ledger_id IS NOT NULL;
END;
$function$;

-- ============================================================
-- 4. New refund_credit by ledger id
-- ============================================================

CREATE OR REPLACE FUNCTION public.refund_credit(
  _user_id   uuid,
  _ledger_id uuid,
  _reason    text   DEFAULT 'refund',
  _metadata  jsonb  DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  spend       public.credit_ledger%ROWTYPE;
  w           public.user_wallets%ROWTYPE;
  plan        public.billing_plans%ROWTYPE;
  src         jsonb;
  bucket      text;
  amt         numeric(10,2);
  new_balance numeric(10,2);
  total_refund numeric(10,2) := 0;
BEGIN
  SELECT * INTO spend
  FROM public.credit_ledger
  WHERE id = _ledger_id AND user_id = _user_id AND delta < 0;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Don't double-refund: bail if any prior ledger row references this id as refund_of
  IF EXISTS (
    SELECT 1 FROM public.credit_ledger
     WHERE user_id = _user_id
       AND (metadata ->> 'refund_of') = _ledger_id::text
  ) THEN
    RETURN false;
  END IF;

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT * INTO plan FROM public.billing_plans WHERE code = w.plan_code;

  -- Walk the sources array and credit each bucket back
  FOR src IN SELECT jsonb_array_elements(COALESCE(spend.metadata -> 'sources', '[]'::jsonb))
  LOOP
    bucket := src ->> 'bucket';
    amt    := (src ->> 'amount')::numeric;
    total_refund := total_refund + amt;

    IF bucket = 'daily_free' THEN
      UPDATE public.user_wallets
         SET daily_free_used   = GREATEST(0, daily_free_used   - amt),
             monthly_free_used = GREATEST(0, monthly_free_used - amt),
             updated_at = now()
       WHERE user_id = _user_id;
    ELSIF bucket = 'monthly_grant' THEN
      UPDATE public.user_wallets
         SET monthly_credits_remaining = monthly_credits_remaining + amt,
             updated_at = now()
       WHERE user_id = _user_id;
    ELSE -- topup or unknown -> topup
      UPDATE public.user_wallets
         SET topup_credits_remaining = topup_credits_remaining + amt,
             updated_at = now()
       WHERE user_id = _user_id;
    END IF;
  END LOOP;

  -- If sources was missing/empty (legacy row), refund into topup as a safety net
  IF total_refund = 0 THEN
    total_refund := -spend.delta;
    UPDATE public.user_wallets
       SET topup_credits_remaining = topup_credits_remaining + total_refund,
           updated_at = now()
     WHERE user_id = _user_id;
  END IF;

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id;
  new_balance := GREATEST(plan.daily_free_credits - w.daily_free_used, 0)
               + w.monthly_credits_remaining
               + w.topup_credits_remaining;

  INSERT INTO public.credit_ledger(user_id, delta, reason, balance_after, project_id, metadata)
  VALUES (_user_id, total_refund, _reason, new_balance, spend.project_id,
          _metadata || jsonb_build_object('refund_of', _ledger_id::text));

  RETURN true;
END;
$function$;

-- ============================================================
-- 5. Build cost analytics view
-- ============================================================

CREATE OR REPLACE VIEW public.v_build_costs AS
SELECT
  project_id,
  user_id,
  COUNT(*)                                   AS entries,
  SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS gross_spent,
  SUM(CASE WHEN delta > 0 THEN  delta ELSE 0 END) AS refunded,
  SUM(-delta)                                AS net_spent,
  MIN(created_at)                            AS first_at,
  MAX(created_at)                            AS last_at
FROM public.credit_ledger
WHERE reason IN ('ai_build_hold','ai_build_topup','ai_build_credit','ai_message','ai_message_refund','ai_discuss','ai_discuss_refund')
  AND project_id IS NOT NULL
GROUP BY project_id, user_id;