
ALTER TABLE public.user_wallets ADD COLUMN IF NOT EXISTS credits_reserved numeric(10,2) NOT NULL DEFAULT 0;

INSERT INTO public.economics_config(key, value, unit, description) VALUES
 ('revenue_per_credit_usd', 0.13, 'usd', 'Revenue represented by one customer credit'),
 ('min_charge_credits', 0.05, 'credits', 'Minimum credits charged for a billable build'),
 ('credit_rounding_step', 0.01, 'credits', 'Build charges round UP to this step'),
 ('reservation_headroom', 3, 'x', 'Reservation = estimate x headroom (capped by balance); also the runaway ceiling'),
 ('estimate_min_samples', 20, 'turns', 'Measured samples needed before a class estimate uses its p90'),
 ('estimate_cost_simple_usd', 0.005, 'usd', 'Default p90 cost, SIMPLE'),
 ('estimate_cost_light_usd', 0.01, 'usd', 'Default p90 cost, LIGHT'),
 ('estimate_cost_standard_usd', 0.03, 'usd', 'Default p90 cost, STANDARD'),
 ('estimate_cost_heavy_usd', 0.05, 'usd', 'Default p90 cost, HEAVY'),
 ('estimate_cost_complex_usd', 0.1, 'usd', 'Default p90 cost, COMPLEX'),
 ('estimate_cost_escalated_usd', 0.15, 'usd', 'Default p90 cost, ESCALATED')
ON CONFLICT (key) DO NOTHING;
UPDATE public.economics_config SET value = 0.026 WHERE key = 'target_variable_cost_per_credit_usd';

-- Available balance excludes credits held for running builds.
CREATE OR REPLACE FUNCTION public.available_credits(_user_id uuid)
 RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  w public.user_wallets%rowtype; plan public.billing_plans%rowtype;
  today date := (now() at time zone 'utc')::date;
  this_month date := date_trunc('month', now() at time zone 'utc')::date;
  daily_avail numeric(10,2); monthly_cap_avail numeric(10,2); free_avail numeric(10,2);
  daily_used_eff numeric(10,2); monthly_used_eff numeric(10,2);
begin
  select * into w from public.user_wallets where user_id = _user_id;
  if not found then
    select * into plan from public.billing_plans where code = 'free' limit 1;
    daily_avail := coalesce(plan.daily_free_credits, 0);
    monthly_cap_avail := coalesce(plan.monthly_free_cap, daily_avail);
    return least(daily_avail, monthly_cap_avail);
  end if;
  select * into plan from public.billing_plans where code = w.plan_code;
  daily_used_eff := case when w.daily_free_reset_at < today then 0 else w.daily_free_used end;
  monthly_used_eff := case when w.monthly_free_reset_at < this_month then 0 else w.monthly_free_used end;
  daily_avail := greatest(least(coalesce(plan.daily_free_credits, 0), 10) - daily_used_eff, 0);
  if plan.monthly_free_cap is null then monthly_cap_avail := daily_avail;
  else monthly_cap_avail := greatest(least(plan.monthly_free_cap, 50) - monthly_used_eff, 0); end if;
  free_avail := least(daily_avail, monthly_cap_avail);
  return greatest(free_avail + coalesce(w.monthly_credits_remaining, 0) + coalesce(w.topup_credits_remaining, 0)
                  - coalesce(w.credits_reserved, 0), 0);
end; $function$;

CREATE OR REPLACE FUNCTION public.check_credit_balance(_user_id uuid, _amount numeric)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN _amount IS NULL OR _amount <= 0 THEN false
              ELSE public.available_credits(_user_id) >= _amount END;
$function$;

-- Reserve credits for one build (one economic operation per turn).
CREATE OR REPLACE FUNCTION public.reserve_build_credits(_user_id uuid, _turn_id uuid, _estimate numeric, _headroom numeric, _class text DEFAULT NULL, _estimate_basis text DEFAULT NULL)
 RETURNS TABLE(ok boolean, reserved numeric, available numeric, idempotent boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE op public.economic_operations%ROWTYPE; avail numeric(10,2); amt numeric(10,2);
BEGIN
  _estimate := round(GREATEST(COALESCE(_estimate, 0), 0.01), 2);
  _headroom := GREATEST(COALESCE(_headroom, 1), 1);
  SELECT * INTO op FROM public.economic_operations WHERE turn_id = _turn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no economic operation for turn %', _turn_id; END IF;
  IF op.user_id <> _user_id THEN RAISE EXCEPTION 'operation does not belong to this user'; END IF;
  IF op.metadata ? 'reservation_state' THEN
    RETURN QUERY SELECT (op.metadata ->> 'reservation_state') IN ('held','settled'), COALESCE(op.credits_reserved, 0)::numeric, public.available_credits(_user_id), true;
    RETURN;
  END IF;
  -- Serialise every reservation for this user on the wallet row.
  INSERT INTO public.user_wallets(user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  avail := public.available_credits(_user_id);
  IF avail < _estimate THEN
    UPDATE public.economic_operations SET credits_estimated = _estimate,
      metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('reservation_state','refused','execution_class',_class,'estimate_basis',_estimate_basis,'available_at_reserve',avail)
     WHERE id = op.id;
    RETURN QUERY SELECT false, 0::numeric, avail, false; RETURN;
  END IF;
  amt := round(LEAST(avail, _estimate * _headroom), 2);
  UPDATE public.user_wallets SET credits_reserved = COALESCE(credits_reserved,0) + amt, updated_at = now() WHERE user_id = _user_id;
  UPDATE public.economic_operations SET credits_estimated = _estimate, credits_reserved = amt,
    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('reservation_state','held','execution_class',_class,'estimate_basis',_estimate_basis,'reserved_at',now())
   WHERE id = op.id;
  RETURN QUERY SELECT true, amt::numeric, avail, false;
END; $function$;

-- Release a held reservation exactly once.
CREATE OR REPLACE FUNCTION public.release_build_reservation(_turn_id uuid, _reason text DEFAULT 'released')
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE op public.economic_operations%ROWTYPE; amt numeric(10,2);
BEGIN
  SELECT * INTO op FROM public.economic_operations WHERE turn_id = _turn_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(op.metadata ->> 'reservation_state','') <> 'held' THEN RETURN 0; END IF;
  amt := COALESCE(op.credits_reserved, 0);
  UPDATE public.user_wallets SET credits_reserved = GREATEST(COALESCE(credits_reserved,0) - amt, 0), updated_at = now() WHERE user_id = op.user_id;
  UPDATE public.economic_operations SET metadata = metadata || jsonb_build_object('reservation_state','released','released_reason',_reason,'released_at',now())
   WHERE id = op.id;
  RETURN amt;
END; $function$;

-- Settlement: charge measured amount, capped by the reservation, never debt.
CREATE OR REPLACE FUNCTION public.settle_build_charge(_user_id uuid, _amount numeric, _reason text DEFAULT 'ai_build_charge'::text, _project_id uuid DEFAULT NULL::uuid, _turn_id uuid DEFAULT NULL::uuid, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(charged numeric, shortfall numeric, ledger_id uuid, idempotent boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE existing public.credit_ledger%ROWTYPE; op public.economic_operations%ROWTYPE;
  avail numeric(10,2); take numeric(10,2); short numeric(10,2); new_ledger uuid; t text;
  held boolean; cap numeric(10,2);
BEGIN
  _amount := round(GREATEST(COALESCE(_amount, 0), 0), 2);
  IF _turn_id IS NULL THEN RAISE EXCEPTION 'build charge requires a turn'; END IF;
  SELECT * INTO op FROM public.economic_operations WHERE turn_id = _turn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no economic operation for turn %', _turn_id; END IF;
  IF op.user_id <> _user_id OR (_project_id IS NOT NULL AND op.project_id <> _project_id) THEN
    RAISE EXCEPTION 'operation does not belong to this user/project';
  END IF;
  SELECT * INTO existing FROM public.credit_ledger WHERE operation_id = op.id AND reason = _reason AND delta < 0 LIMIT 1;
  IF FOUND THEN RETURN QUERY SELECT ABS(existing.delta)::numeric(10,2), 0::numeric(10,2), existing.id, true; RETURN; END IF;
  IF COALESCE(op.metadata ->> 'reservation_state','') = 'settled' THEN
    RETURN QUERY SELECT COALESCE(op.credits_charged,0)::numeric(10,2), 0::numeric(10,2), NULL::uuid, true; RETURN;
  END IF;
  t := upper(COALESCE(_metadata ->> 'operation_type', ''));
  IF t IN ('FIRST_BUILD','ITERATION','DESIGN_SYSTEM_CHANGE','DEBUG_FIX','RETRY','RECOVERY','RESTORE','UNDO') THEN
    UPDATE public.economic_operations SET operation_type = t WHERE id = op.id AND operation_type = 'OTHER';
  END IF;
  UPDATE public.economic_operations SET credits_estimated = COALESCE(credits_estimated, NULLIF(_metadata ->> 'estimated_credits','')::numeric) WHERE id = op.id;
  -- Free this build's own hold first; the reservation is the ceiling.
  held := COALESCE(op.metadata ->> 'reservation_state','') = 'held';
  cap := CASE WHEN held THEN COALESCE(op.credits_reserved, 0) ELSE NULL END;
  IF held THEN
    UPDATE public.user_wallets SET credits_reserved = GREATEST(COALESCE(credits_reserved,0) - cap, 0), updated_at = now() WHERE user_id = _user_id;
  END IF;
  IF cap IS NOT NULL AND _amount > cap THEN _amount := cap; END IF;
  take := 0; short := 0;
  IF _amount > 0 THEN
    avail := COALESCE(public.available_credits(_user_id), 0);
    take  := LEAST(_amount, GREATEST(floor(avail * 100) / 100, 0));
    short := round(_amount - take, 2);
    IF take > 0 THEN
      new_ledger := public.spend_credit(_user_id, take, _reason, _project_id,
        _metadata || jsonb_build_object('priced_amount', _amount, 'uncollected', short, 'reserved', cap), op.id);
      IF new_ledger IS NULL THEN take := 0; short := _amount; END IF;
    END IF;
  END IF;
  -- No customer debt from builds: anything uncollected is Kimble's, recorded internally.
  UPDATE public.economic_operations SET
    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
      'reservation_state', CASE WHEN held THEN 'settled' ELSE COALESCE(metadata ->> 'reservation_state','none') END,
      'settled_amount', take, 'uncollected', short, 'settled_at', now())
   WHERE id = op.id;
  RETURN QUERY SELECT take, short, new_ledger, false;
END; $function$;

-- Every terminal turn releases any hold still open (exactly-once safety net).
CREATE OR REPLACE FUNCTION public.turns_release_reservation()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'running' AND NEW.status <> 'running' THEN
    PERFORM public.release_build_reservation(NEW.id, 'turn_' || NEW.status);
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS turns_release_reservation ON public.turns;
CREATE TRIGGER turns_release_reservation AFTER UPDATE OF status ON public.turns
  FOR EACH ROW EXECUTE FUNCTION public.turns_release_reservation();

-- Measured p90 AI cost for an execution class (null until enough samples).
CREATE OR REPLACE FUNCTION public.billing_class_cost_p90(_class text, _min_samples integer DEFAULT 20)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT ai_cost_usd_micro / 1e6 AS usd FROM public.turn_economics
     WHERE COALESCE(metadata -> 'execution' ->> 'class', metadata ->> 'execution_class') = _class
       AND cost_basis IN ('actual','estimated') AND ai_cost_usd_micro > 0
       AND is_auto_fix = false AND created_at > now() - interval '90 days')
  SELECT CASE WHEN count(*) >= GREATEST(_min_samples,1)
              THEN round((percentile_cont(0.9) WITHIN GROUP (ORDER BY usd))::numeric, 6) END FROM s;
$function$;

-- Admin build-billing summary (internal economics; never customer-facing).
CREATE OR REPLACE FUNCTION public.build_billing_summary(_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH te AS (
    SELECT t.*, COALESCE(t.metadata -> 'execution' ->> 'class', t.metadata ->> 'execution_class', 'UNKNOWN') AS cls,
           COALESCE(t.ai_cost_usd_micro,0)/1e6 AS ai_usd, COALESCE(t.variable_cost_usd_micro, t.ai_cost_usd_micro, 0)/1e6 AS var_usd
      FROM public.turn_economics t
     WHERE t.feature = 'generate' AND t.created_at > now() - make_interval(days => _days)),
  led AS (
    SELECT COALESCE(sum(-delta) FILTER (WHERE reason = 'ai_build_charge'),0) AS charged,
           COALESCE(sum(delta) FILTER (WHERE reason IN ('ai_build_rollback_refund','refund') AND delta > 0),0) AS refunded
      FROM public.credit_ledger WHERE created_at > now() - make_interval(days => _days)),
  ops AS (
    SELECT COALESCE(sum(credits_estimated),0) AS estimated, COALESCE(sum(credits_reserved),0) AS reserved,
           COALESCE(sum((metadata ->> 'uncollected')::numeric),0) AS uncollected,
           count(*) FILTER (WHERE metadata ->> 'reservation_state' = 'refused') AS refused
      FROM public.economic_operations WHERE created_at > now() - make_interval(days => _days)),
  cfg AS (SELECT COALESCE(max(value) FILTER (WHERE key='revenue_per_credit_usd'),0.13) AS rev FROM public.economics_config)
  SELECT jsonb_build_object(
    'days', _days,
    'builds', (SELECT count(*) FROM te),
    'credits_charged', (SELECT charged FROM led),
    'credits_refunded', (SELECT refunded FROM led),
    'credits_estimated', (SELECT estimated FROM ops),
    'credits_reserved', (SELECT reserved FROM ops),
    'credits_uncollected', (SELECT uncollected FROM ops),
    'reservations_refused', (SELECT refused FROM ops),
    'ai_cost_usd', (SELECT round(sum(ai_usd)::numeric,4) FROM te),
    'variable_cost_usd', (SELECT round(sum(var_usd)::numeric,4) FROM te),
    'revenue_per_credit_usd', (SELECT rev FROM cfg),
    'revenue_usd', (SELECT round(((SELECT charged FROM led) - (SELECT refunded FROM led)) * rev, 4) FROM cfg),
    'contribution_usd', (SELECT round(((SELECT charged FROM led) - (SELECT refunded FROM led)) * rev - COALESCE((SELECT sum(var_usd) FROM te),0), 4) FROM cfg),
    'avg_cost_per_build_usd', (SELECT round(avg(var_usd)::numeric,4) FROM te),
    'avg_credits_per_build', (SELECT round(avg(credits_charged)::numeric,3) FROM te WHERE credits_charged > 0),
    'failed_build_cost_usd', (SELECT round(COALESCE(sum(var_usd),0)::numeric,4) FROM te WHERE result IN ('failed','aborted','cancelled','no_op')),
    'refunded_build_cost_usd', (SELECT round(COALESCE(sum(var_usd),0)::numeric,4) FROM te WHERE COALESCE(credits_refunded,0) > 0),
    'by_basis', (SELECT COALESCE(jsonb_object_agg(b, jsonb_build_object('turns', n, 'cost_usd', c)), '{}'::jsonb) FROM (SELECT COALESCE(cost_basis,'unknown') b, count(*) n, round(sum(var_usd)::numeric,4) c FROM te GROUP BY 1) x),
    'by_class', (SELECT COALESCE(jsonb_object_agg(cls, jsonb_build_object('turns', n, 'cost_usd', c, 'avg_cost_usd', a, 'credits', cr, 'p90_cost_usd', p90)), '{}'::jsonb)
                 FROM (SELECT cls, count(*) n, round(sum(var_usd)::numeric,4) c, round(avg(var_usd)::numeric,4) a, round(sum(credits_charged)::numeric,2) cr,
                              round((percentile_cont(0.9) WITHIN GROUP (ORDER BY var_usd))::numeric,4) p90 FROM te GROUP BY 1) x),
    'by_outcome', (SELECT COALESCE(jsonb_object_agg(r, jsonb_build_object('turns', n, 'cost_usd', c, 'credits', cr)), '{}'::jsonb)
                 FROM (SELECT COALESCE(result,'unknown') r, count(*) n, round(sum(var_usd)::numeric,4) c, round(sum(credits_charged)::numeric,2) cr FROM te GROUP BY 1) x),
    'by_model', (SELECT COALESCE(jsonb_object_agg(m, jsonb_build_object('calls', n, 'cost_usd', c, 'actual_calls', a, 'estimated_calls', e)), '{}'::jsonb)
                 FROM (SELECT COALESCE(model,'unknown') m, count(*) n, round((sum(COALESCE(cost_usd_micro,0))/1e6)::numeric,4) c,
                              count(*) FILTER (WHERE cost_basis='actual') a, count(*) FILTER (WHERE cost_basis='estimated') e
                         FROM public.ai_call_log WHERE created_at > now() - make_interval(days => _days) GROUP BY 1 ORDER BY 3 DESC LIMIT 15) x)
  );
$function$;

REVOKE ALL ON FUNCTION public.reserve_build_credits(uuid,uuid,numeric,numeric,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_build_reservation(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_class_cost_p90(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_billing_summary(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_build_charge(uuid,numeric,text,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_build_credits(uuid,uuid,numeric,numeric,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_build_reservation(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_class_cost_p90(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.build_billing_summary(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_build_charge(uuid,numeric,text,uuid,uuid,jsonb) TO service_role;
