-- ===== Build-only purpose for free credits =====
CREATE OR REPLACE FUNCTION public.is_build_credit_reason(_reason text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _reason IN ('ai_build_charge','ai_build_hold','ai_build_topup')
$$;

CREATE OR REPLACE FUNCTION public.spend_credit(_user_id uuid, _amount numeric, _reason text DEFAULT 'ai_message'::text, _project_id uuid DEFAULT NULL::uuid, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  w public.user_wallets%ROWTYPE; plan public.billing_plans%ROWTYPE;
  today date := (now() AT TIME ZONE 'utc')::date;
  this_month date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
  ledger_id uuid; daily_avail numeric(10,2); monthly_cap_avail numeric(10,2); free_avail numeric(10,2);
  free_take numeric(10,2) := 0; grant_take numeric(10,2) := 0; topup_take numeric(10,2) := 0;
  remaining numeric(10,2); total_avail numeric(10,2); new_balance numeric(10,2);
  sources jsonb := '[]'::jsonb; lot RECORD; lot_left numeric(10,2); lot_take numeric(10,2);
  is_build boolean := public.is_build_credit_reason(_reason);
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0 (got %)', _amount; END IF;
  _amount := round(_amount, 2);
  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN INSERT INTO public.user_wallets(user_id) VALUES (_user_id) RETURNING * INTO w; END IF;
  SELECT * INTO plan FROM public.billing_plans WHERE code = w.plan_code;
  IF w.daily_free_reset_at < today THEN w.daily_free_used := 0; w.daily_free_reset_at := today; END IF;
  IF w.monthly_free_reset_at < this_month THEN w.monthly_free_used := 0; w.monthly_free_reset_at := this_month; END IF;
  daily_avail := GREATEST(LEAST(COALESCE(plan.daily_free_credits,0),10) - w.daily_free_used, 0);
  monthly_cap_avail := GREATEST(LEAST(COALESCE(plan.monthly_free_cap,50),50) - w.monthly_free_used, 0);
  -- Free BUILD credits fund building only. Enforced here, not in the UI.
  free_avail := CASE WHEN is_build THEN LEAST(daily_avail, monthly_cap_avail) ELSE 0 END;
  total_avail := free_avail + w.monthly_credits_remaining + w.topup_credits_remaining;
  IF total_avail < _amount THEN RETURN NULL; END IF;
  remaining := _amount;
  IF remaining > 0 AND free_avail > 0 THEN free_take := LEAST(free_avail, remaining); remaining := remaining - free_take; END IF;
  IF remaining > 0 AND w.monthly_credits_remaining > 0 THEN grant_take := LEAST(w.monthly_credits_remaining, remaining); remaining := remaining - grant_take; END IF;
  IF remaining > 0 AND w.topup_credits_remaining > 0 THEN topup_take := LEAST(w.topup_credits_remaining, remaining); remaining := remaining - topup_take; END IF;
  IF remaining > 0 THEN RETURN NULL; END IF;
  UPDATE public.user_wallets SET daily_free_used = w.daily_free_used + free_take, daily_free_reset_at = w.daily_free_reset_at,
     monthly_free_used = w.monthly_free_used + free_take, monthly_free_reset_at = w.monthly_free_reset_at,
     monthly_credits_remaining = w.monthly_credits_remaining - grant_take, topup_credits_remaining = w.topup_credits_remaining - topup_take, updated_at = now()
   WHERE user_id = _user_id;
  IF topup_take > 0 THEN
    lot_left := topup_take;
    FOR lot IN SELECT id, credits_remaining FROM public.topup_lots WHERE user_id = _user_id AND credits_remaining > 0 ORDER BY created_at ASC FOR UPDATE LOOP
      EXIT WHEN lot_left <= 0;
      lot_take := LEAST(lot.credits_remaining, lot_left);
      UPDATE public.topup_lots SET credits_remaining = credits_remaining - lot_take, updated_at = now() WHERE id = lot.id;
      lot_left := lot_left - lot_take;
    END LOOP;
  END IF;
  new_balance := GREATEST(LEAST(COALESCE(plan.daily_free_credits,0),10) - (w.daily_free_used + free_take), 0) + (w.monthly_credits_remaining - grant_take) + (w.topup_credits_remaining - topup_take);
  IF free_take > 0 THEN sources := sources || jsonb_build_array(jsonb_build_object('bucket','daily_free','amount',free_take,'day',today)); END IF;
  IF grant_take > 0 THEN sources := sources || jsonb_build_array(jsonb_build_object('bucket','monthly_grant','amount',grant_take)); END IF;
  IF topup_take > 0 THEN sources := sources || jsonb_build_array(jsonb_build_object('bucket','topup','amount',topup_take)); END IF;
  INSERT INTO public.credit_ledger(user_id, delta, reason, balance_after, project_id, metadata)
  VALUES (_user_id, -_amount, _reason, new_balance, _project_id,
          _metadata || jsonb_build_object('sources', sources, 'free_build_credits', free_take, 'paid_credits', grant_take + topup_take))
  RETURNING id INTO ledger_id;
  RETURN ledger_id;
END; $function$;

-- Restore free credits without creating extra allowance.
CREATE OR REPLACE FUNCTION public.restore_free_build_credits(_user_id uuid, _amount numeric, _spent_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'utc')::date;
  this_month date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RETURN; END IF;
  -- Daily allowance comes back only if the spend happened today (UTC).
  -- Monthly allowance comes back only within the same month. Never below 0,
  -- so neither the 10/day nor the 50/month limit can be exceeded.
  UPDATE public.user_wallets SET
    daily_free_used = CASE WHEN (_spent_at AT TIME ZONE 'utc')::date = today AND daily_free_reset_at = today
                           THEN GREATEST(0, daily_free_used - _amount) ELSE daily_free_used END,
    monthly_free_used = CASE WHEN date_trunc('month', _spent_at AT TIME ZONE 'utc')::date = this_month AND monthly_free_reset_at = this_month
                           THEN GREATEST(0, monthly_free_used - _amount) ELSE monthly_free_used END,
    updated_at = now()
  WHERE user_id = _user_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.restore_free_build_credits(uuid, numeric, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refund_credit(_user_id uuid, _ledger_id uuid, _reason text DEFAULT 'refund'::text, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE spend public.credit_ledger%ROWTYPE; w public.user_wallets%ROWTYPE; plan public.billing_plans%ROWTYPE;
  src jsonb; bucket text; amt numeric(10,2); new_balance numeric(10,2); total_refund numeric(10,2) := 0;
BEGIN
  SELECT * INTO spend FROM public.credit_ledger WHERE id = _ledger_id AND user_id = _user_id AND delta < 0;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.credit_ledger WHERE user_id = _user_id AND ((metadata ->> 'refund_of') = _ledger_id::text OR (metadata ->> 'refund_of_ledger') = _ledger_id::text)) THEN RETURN false; END IF;
  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO plan FROM public.billing_plans WHERE code = w.plan_code;
  FOR src IN SELECT jsonb_array_elements(COALESCE(spend.metadata -> 'sources', '[]'::jsonb)) LOOP
    bucket := src ->> 'bucket'; amt := (src ->> 'amount')::numeric; total_refund := total_refund + amt;
    IF bucket = 'daily_free' THEN PERFORM public.restore_free_build_credits(_user_id, amt, spend.created_at);
    ELSIF bucket = 'monthly_grant' THEN UPDATE public.user_wallets SET monthly_credits_remaining = monthly_credits_remaining + amt, updated_at = now() WHERE user_id = _user_id;
    ELSE UPDATE public.user_wallets SET topup_credits_remaining = topup_credits_remaining + amt, updated_at = now() WHERE user_id = _user_id; END IF;
  END LOOP;
  IF total_refund = 0 THEN
    total_refund := -spend.delta;
    UPDATE public.user_wallets SET topup_credits_remaining = topup_credits_remaining + total_refund, updated_at = now() WHERE user_id = _user_id;
  END IF;
  new_balance := COALESCE(public.available_credits(_user_id), 0);
  INSERT INTO public.credit_ledger(user_id, delta, reason, balance_after, project_id, metadata)
  VALUES (_user_id, total_refund, _reason, new_balance, spend.project_id,
          _metadata || jsonb_build_object('refund_of', _ledger_id, 'sources', spend.metadata -> 'sources'));
  RETURN true;
END; $function$;

-- ===== Outcome-aware build refund =====
CREATE OR REPLACE FUNCTION public.refund_build_charge(_project_id uuid, _build_id uuid, _reason text DEFAULT 'ai_build_rollback_refund'::text)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE existing public.credit_ledger%ROWTYPE; charge public.credit_ledger%ROWTYPE; b public.project_builds%ROWTYPE;
  proj_rev bigint; amt numeric(10,2); pay_debt numeric(10,2); give_back numeric(10,2); w public.user_wallets%ROWTYPE;
  src jsonb; bucket text; bamt numeric(10,2); split numeric(10,2) := 0;
BEGIN
  IF _project_id IS NULL OR _build_id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO b FROM public.project_builds WHERE id = _build_id AND project_id = _project_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  -- The customer got the outcome: never refund.
  IF b.status = 'ready' THEN RETURN 0; END IF;
  SELECT revision INTO proj_rev FROM public.projects WHERE id = _project_id;
  -- Stale result for an older version: never refunds on its own.
  IF b.project_revision IS NOT NULL AND proj_rev IS NOT NULL AND b.project_revision < proj_rev THEN RETURN 0; END IF;
  -- Another build of the same version was delivered: the customer got it.
  IF EXISTS (SELECT 1 FROM public.project_builds o WHERE o.project_id = _project_id AND o.id <> _build_id AND o.status = 'ready'
             AND o.project_revision IS NOT DISTINCT FROM b.project_revision AND b.project_revision IS NOT NULL) THEN RETURN 0; END IF;
  SELECT * INTO existing FROM public.credit_ledger WHERE turn_id = _build_id LIMIT 1;
  IF FOUND THEN RETURN 0; END IF;
  SELECT * INTO charge FROM public.credit_ledger c
  WHERE c.project_id = _project_id AND c.delta < 0 AND c.reason = 'ai_build_charge' AND c.created_at > now() - interval '6 hours'
    AND NOT EXISTS (SELECT 1 FROM public.credit_ledger r WHERE r.delta > 0 AND ((r.metadata ->> 'refund_of_ledger') = c.id::text OR (r.metadata ->> 'refund_of') = c.id::text))
  ORDER BY (c.turn_id = _build_id) DESC, c.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;
  amt := round(ABS(charge.delta), 2);
  IF amt <= 0 THEN RETURN 0; END IF;
  SELECT * INTO w FROM public.user_wallets WHERE user_id = charge.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  pay_debt := LEAST(COALESCE(w.credit_debt, 0), amt); give_back := amt - pay_debt;
  UPDATE public.user_wallets SET credit_debt = GREATEST(0, COALESCE(credit_debt, 0) - pay_debt), updated_at = now() WHERE user_id = charge.user_id;
  IF give_back > 0 THEN
    FOR src IN SELECT jsonb_array_elements(COALESCE(charge.metadata -> 'sources', '[]'::jsonb)) LOOP
      bucket := src ->> 'bucket'; bamt := round(((src ->> 'amount')::numeric) * (give_back / amt), 2);
      IF bamt <= 0 THEN CONTINUE; END IF;
      split := split + bamt;
      IF bucket = 'daily_free' THEN PERFORM public.restore_free_build_credits(charge.user_id, bamt, charge.created_at);
      ELSIF bucket = 'monthly_grant' THEN UPDATE public.user_wallets SET monthly_credits_remaining = monthly_credits_remaining + bamt, updated_at = now() WHERE user_id = charge.user_id;
      ELSE UPDATE public.user_wallets SET topup_credits_remaining = topup_credits_remaining + bamt, updated_at = now() WHERE user_id = charge.user_id; END IF;
    END LOOP;
    IF split = 0 THEN UPDATE public.user_wallets SET topup_credits_remaining = topup_credits_remaining + give_back, updated_at = now() WHERE user_id = charge.user_id; END IF;
  END IF;
  INSERT INTO public.credit_ledger(user_id, delta, balance_after, reason, project_id, turn_id, metadata)
  VALUES (charge.user_id, amt, COALESCE(public.available_credits(charge.user_id), 0), _reason, _project_id, _build_id,
          jsonb_build_object('refund_of_ledger', charge.id, 'build_id', _build_id, 'debt_cleared', pay_debt, 'sources', charge.metadata -> 'sources'));
  RETURN amt;
END; $function$;

-- ===== Cost ledger =====
CREATE TABLE public.cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, project_id uuid, turn_id text, revision bigint, build_id uuid,
  stage text, category text NOT NULL, provider text, resource text,
  quantity numeric, unit text, cost_usd numeric(14,6),
  cost_basis text NOT NULL, funded_by text, failed_work boolean NOT NULL DEFAULT false,
  source_ref text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_events_category_chk CHECK (category IN ('AI_INFERENCE','AI_VERIFICATION','AI_REASONING','IMAGE_GENERATION','BUILD_COMPUTE','BROWSER_COMPUTE','DEPLOYMENT','STORAGE','DATABASE','NETWORK','OTHER_VARIABLE','FAILED_WORK')),
  CONSTRAINT cost_events_basis_chk CHECK (cost_basis IN ('ACTUAL','ESTIMATED','ALLOCATED','UNKNOWN')),
  CONSTRAINT cost_events_unknown_null CHECK (cost_basis <> 'UNKNOWN' OR cost_usd IS NULL)
);
CREATE UNIQUE INDEX cost_events_source_ref_uq ON public.cost_events(source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX cost_events_turn_idx ON public.cost_events(turn_id);
CREATE INDEX cost_events_build_idx ON public.cost_events(build_id);
GRANT SELECT ON public.cost_events TO authenticated;
GRANT ALL ON public.cost_events TO service_role;
ALTER TABLE public.cost_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read cost events" ON public.cost_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE OR REPLACE FUNCTION public.cost_events_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'cost_events are append-only'; END; $$;
CREATE TRIGGER cost_events_no_update BEFORE UPDATE OR DELETE ON public.cost_events FOR EACH ROW EXECUTE FUNCTION public.cost_events_immutable();

CREATE TABLE public.infra_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL UNIQUE, plan text, monthly_fixed_usd numeric(12,2),
  usage_components text, usage_metrics text, per_turn_allocation_possible boolean NOT NULL DEFAULT false,
  allocation_method text, confidence text NOT NULL DEFAULT 'unknown', notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.infra_services TO authenticated;
GRANT ALL ON public.infra_services TO service_role;
ALTER TABLE public.infra_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage infra services" ON public.infra_services FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.infra_services(service, allocation_method, confidence, notes) VALUES
 ('Railway builder', 'not allocated per build; build minutes estimated at build_minute_usd', 'unknown', 'Monthly bill not entered'),
 ('Database / backend', 'shared fixed cost, not allocated', 'unknown', 'Monthly bill not entered'),
 ('Cloudflare hosting', 'shared fixed cost, not allocated', 'unknown', 'Monthly bill not entered'),
 ('Storage', 'shared fixed cost, not allocated', 'unknown', NULL),
 ('Email', 'shared fixed cost, not allocated', 'unknown', NULL),
 ('Image provider', 'per image when provider reports cost', 'unknown', NULL),
 ('OpenRouter', 'per call, provider-reported actual cost', 'actual', 'Direct variable cost');

-- ===== Build timings & turn economics extensions =====
ALTER TABLE public.project_builds
  ADD COLUMN IF NOT EXISTS turn_id text, ADD COLUMN IF NOT EXISTS builder_job_id text,
  ADD COLUMN IF NOT EXISTS install_ms integer, ADD COLUMN IF NOT EXISTS compile_ms integer,
  ADD COLUMN IF NOT EXISTS browser_ms integer, ADD COLUMN IF NOT EXISTS deploy_ms integer,
  ADD COLUMN IF NOT EXISTS deployed boolean, ADD COLUMN IF NOT EXISTS failure_class text;

ALTER TABLE public.turn_economics
  ADD COLUMN IF NOT EXISTS economics_cohort text, ADD COLUMN IF NOT EXISTS revision bigint,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS credits_estimated numeric(10,2), ADD COLUMN IF NOT EXISTS credits_reserved numeric(10,2),
  ADD COLUMN IF NOT EXISTS free_credits_charged numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_credits_charged numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_cost_usd_micro bigint, ADD COLUMN IF NOT EXISTS browser_cost_usd_micro bigint,
  ADD COLUMN IF NOT EXISTS reasoning_tokens bigint NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS cache_write_tokens bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS redundant_calls integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS retry_calls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_calls integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS verification_calls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_state text NOT NULL DEFAULT 'running',
  ADD COLUMN IF NOT EXISTS refund_reason text;

ALTER TABLE public.ai_call_log ADD COLUMN IF NOT EXISTS session_id text, ADD COLUMN IF NOT EXISTS build_id uuid,
  ADD COLUMN IF NOT EXISTS revision bigint, ADD COLUMN IF NOT EXISTS call_class text;

-- Assign the next 10 real generations to the measurement cohort.
CREATE OR REPLACE FUNCTION public.assign_economics_cohort() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NEW.economics_cohort IS NOT NULL OR NEW.is_auto_fix OR NEW.feature <> 'generate' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('economics_cohort_2026_10_10'));
  SELECT count(*) INTO n FROM public.turn_economics WHERE economics_cohort LIKE '2026-10-10-BUILD-%';
  IF n < 10 THEN NEW.economics_cohort := '2026-10-10-BUILD-' || lpad((n+1)::text, 2, '0'); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS turn_economics_cohort ON public.turn_economics;
CREATE TRIGGER turn_economics_cohort BEFORE INSERT ON public.turn_economics FOR EACH ROW EXECUTE FUNCTION public.assign_economics_cohort();

-- ===== Admin cohort report =====
CREATE OR REPLACE FUNCTION public.economics_cohort_report(_cohort_prefix text DEFAULT '2026-10-10-BUILD-')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; retail numeric := 0.13;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  WITH t AS (
    SELECT te.*, (te.credits_charged - te.credits_refunded) AS retained,
      (SELECT sum(cost_usd) FROM public.cost_events ce WHERE ce.turn_id = te.turn_id AND ce.cost_basis='ACTUAL') AS measured,
      (SELECT sum(cost_usd) FROM public.cost_events ce WHERE ce.turn_id = te.turn_id AND ce.cost_basis='ESTIMATED') AS estimated,
      (SELECT sum(cost_usd) FROM public.cost_events ce WHERE ce.turn_id = te.turn_id AND ce.cost_basis='ALLOCATED') AS allocated,
      (SELECT count(*) FROM public.cost_events ce WHERE ce.turn_id = te.turn_id AND ce.cost_basis='UNKNOWN') AS unknown_events,
      (SELECT sum(cost_usd) FROM public.cost_events ce WHERE ce.turn_id = te.turn_id AND ce.failed_work) AS failed_cost
    FROM public.turn_economics te WHERE te.economics_cohort LIKE _cohort_prefix || '%'
  ), c AS (SELECT *, COALESCE(measured,0)+COALESCE(estimated,0) AS direct FROM t)
  SELECT jsonb_build_object(
    'builds', count(*),
    'successful', count(*) FILTER (WHERE result = 'ready'),
    'failed', count(*) FILTER (WHERE result IS DISTINCT FROM 'ready'),
    'credits_charged', sum(credits_charged), 'credits_refunded', sum(credits_refunded), 'credits_retained', sum(retained),
    'free_credits', sum(free_credits_charged), 'paid_credits', sum(paid_credits_charged),
    'revenue_retained_usd', round(sum(paid_credits_charged - LEAST(credits_refunded, paid_credits_charged)) * retail, 4),
    'refunded_revenue_usd', round(sum(LEAST(credits_refunded, paid_credits_charged)) * retail, 4),
    'measured_cost_usd', sum(measured), 'estimated_cost_usd', sum(estimated), 'allocated_cost_usd', sum(allocated),
    'unknown_cost_events', sum(unknown_events), 'failed_work_cost_usd', sum(failed_cost),
    'ai_cost_usd', sum(ai_cost_usd_micro)/1e6, 'image_cost_usd', sum(image_cost_usd_micro)/1e6,
    'build_cost_usd', sum(build_cost_usd_micro)/1e6, 'browser_cost_usd', sum(browser_cost_usd_micro)/1e6,
    'prompt_tokens', sum(prompt_tokens), 'cached_tokens', sum(cached_prompt_tokens),
    'cache_hit_rate', CASE WHEN sum(prompt_tokens) > 0 THEN round(sum(cached_prompt_tokens)::numeric / sum(prompt_tokens), 4) END,
    'redundant_calls', sum(redundant_calls), 'retry_calls', sum(retry_calls), 'recovery_calls', sum(recovery_calls),
    'cost_per_credit', CASE WHEN sum(credits_charged) > 0 THEN round(sum(direct) / sum(credits_charged), 5) END,
    'cost_per_retained_credit', CASE WHEN sum(retained) > 0 THEN round(sum(direct) / sum(retained), 5) END,
    'cost_per_successful_build', CASE WHEN count(*) FILTER (WHERE result='ready') > 0 THEN round(sum(direct) / count(*) FILTER (WHERE result='ready'), 5) END,
    'avg_build_cost', round(avg(direct),5),
    'median_build_cost', percentile_cont(0.5) WITHIN GROUP (ORDER BY direct),
    'p75_build_cost', percentile_cont(0.75) WITHIN GROUP (ORDER BY direct),
    'p90_build_cost', percentile_cont(0.9) WITHIN GROUP (ORDER BY direct),
    'worst_build_cost', max(direct),
    'margin_targets', jsonb_build_object('75', 0.0325, '80', 0.026, '85', 0.0195),
    'retail_usd_per_credit', retail,
    'rows', jsonb_agg(jsonb_build_object('cohort', economics_cohort, 'turn', turn_id, 'project', project_id, 'result', result,
       'charged', credits_charged, 'refunded', credits_refunded, 'free', free_credits_charged, 'paid', paid_credits_charged,
       'measured', measured, 'estimated', estimated, 'unknown_events', unknown_events, 'ai_calls', ai_calls,
       'prompt_tokens', prompt_tokens, 'completion_tokens', completion_tokens, 'cached', cached_prompt_tokens,
       'reasoning', reasoning_tokens, 'refund_reason', refund_reason) ORDER BY economics_cohort)
  ) INTO r FROM c;
  RETURN r;
END; $$;
REVOKE EXECUTE ON FUNCTION public.economics_cohort_report(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.economics_cohort_report(text) TO authenticated;