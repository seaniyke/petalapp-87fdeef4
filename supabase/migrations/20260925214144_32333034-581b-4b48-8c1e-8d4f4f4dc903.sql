-- ===== Economic operations: authoritative identity for one customer request =====
CREATE TABLE public.economic_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL UNIQUE REFERENCES public.turns(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  operation_type text NOT NULL DEFAULT 'OTHER',
  credit_purpose text NOT NULL DEFAULT 'NON_BUILD',
  base_revision bigint,
  committed_revision bigint,
  build_revision bigint,
  published_revision bigint,
  settlement_state text NOT NULL DEFAULT 'CREATED',
  attribution text NOT NULL DEFAULT 'CUSTOMER',
  credits_estimated numeric(10,2),
  credits_reserved numeric(10,2),
  credits_charged numeric(10,2) NOT NULL DEFAULT 0,
  credits_refunded numeric(10,2) NOT NULL DEFAULT 0,
  free_credits_charged numeric(10,2) NOT NULL DEFAULT 0,
  paid_credits_charged numeric(10,2) NOT NULL DEFAULT 0,
  build_attempts integer NOT NULL DEFAULT 0,
  outcome text,
  failure_class text,
  economics_cohort text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eo_type_chk CHECK (operation_type IN ('FIRST_BUILD','ITERATION','DESIGN_SYSTEM_CHANGE','DEBUG_FIX','RETRY','RECOVERY','RESTORE','UNDO','OTHER')),
  CONSTRAINT eo_purpose_chk CHECK (credit_purpose IN ('BUILD','NON_BUILD')),
  CONSTRAINT eo_state_chk CHECK (settlement_state IN ('CREATED','RESERVED','EXECUTING','COMMITTED','BUILDING','VERIFYING','READY','FAILED','SETTLED','REFUNDED','CANCELLED')),
  CONSTRAINT eo_attr_chk CHECK (attribution IN ('CUSTOMER','SYSTEM','SHARED')),
  CONSTRAINT eo_commit_chk CHECK (committed_revision IS NULL OR base_revision IS NULL OR committed_revision > base_revision),
  CONSTRAINT eo_build_chk CHECK (build_revision IS NULL OR committed_revision IS NULL OR build_revision = committed_revision)
);
CREATE INDEX eo_project_idx ON public.economic_operations(project_id, created_at DESC);
CREATE INDEX eo_user_idx ON public.economic_operations(user_id, created_at DESC);
GRANT SELECT ON public.economic_operations TO authenticated;
GRANT ALL ON public.economic_operations TO service_role;
ALTER TABLE public.economic_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read economic operations" ON public.economic_operations FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Free BUILD credits: fixed server-side allow-list. Unknown/future types are NON_BUILD.
CREATE OR REPLACE FUNCTION public.operation_credit_purpose(_type text, _produced_revision boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _produced_revision AND _type IN ('FIRST_BUILD','ITERATION','DEBUG_FIX','DESIGN_SYSTEM_CHANGE','RESTORE','UNDO')
              THEN 'BUILD' ELSE 'NON_BUILD' END
$$;

-- Allowed settlement moves. Same-state is a no-op; anything else is refused (state kept).
CREATE OR REPLACE FUNCTION public.operation_transition_allowed(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _from = _to OR CASE _from
    WHEN 'CREATED'   THEN _to IN ('RESERVED','EXECUTING','COMMITTED','FAILED','CANCELLED','SETTLED')
    WHEN 'RESERVED'  THEN _to IN ('EXECUTING','COMMITTED','FAILED','CANCELLED','SETTLED')
    WHEN 'EXECUTING' THEN _to IN ('COMMITTED','FAILED','CANCELLED','SETTLED')
    WHEN 'COMMITTED' THEN _to IN ('BUILDING','FAILED','CANCELLED','SETTLED')
    WHEN 'BUILDING'  THEN _to IN ('VERIFYING','READY','FAILED')
    WHEN 'VERIFYING' THEN _to IN ('READY','FAILED')
    WHEN 'READY'     THEN _to IN ('SETTLED')
    WHEN 'FAILED'    THEN _to IN ('BUILDING','REFUNDED','SETTLED')
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.economic_operations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Identity is immutable.
  IF NEW.id <> OLD.id OR NEW.turn_id <> OLD.turn_id OR NEW.user_id <> OLD.user_id OR NEW.project_id <> OLD.project_id
     OR NEW.base_revision IS DISTINCT FROM OLD.base_revision THEN
    RAISE EXCEPTION 'economic operation identity is immutable';
  END IF;
  -- Revisions are write-once.
  IF OLD.committed_revision IS NOT NULL AND NEW.committed_revision IS DISTINCT FROM OLD.committed_revision THEN NEW.committed_revision := OLD.committed_revision; END IF;
  IF OLD.build_revision IS NOT NULL AND NEW.build_revision IS DISTINCT FROM OLD.build_revision THEN NEW.build_revision := OLD.build_revision; END IF;
  -- Operation type is set once (OTHER -> concrete).
  IF OLD.operation_type <> 'OTHER' AND NEW.operation_type <> OLD.operation_type THEN NEW.operation_type := OLD.operation_type; END IF;
  -- Purpose is always derived, never chosen.
  NEW.credit_purpose := public.operation_credit_purpose(NEW.operation_type, NEW.committed_revision IS NOT NULL);
  IF NOT public.operation_transition_allowed(OLD.settlement_state, NEW.settlement_state) THEN
    NEW.settlement_state := OLD.settlement_state;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER economic_operations_guard BEFORE UPDATE ON public.economic_operations FOR EACH ROW EXECUTE FUNCTION public.economic_operations_guard();
CREATE OR REPLACE FUNCTION public.economic_operations_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'economic operations are append-only'; END; $$;
CREATE TRIGGER economic_operations_no_delete BEFORE DELETE ON public.economic_operations FOR EACH ROW EXECUTE FUNCTION public.economic_operations_no_delete();

-- The server creates the operation when the turn is created. Never the client.
CREATE OR REPLACE FUNCTION public.create_operation_for_turn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.economic_operations(turn_id, user_id, project_id, base_revision, settlement_state)
  VALUES (NEW.id, NEW.user_id, NEW.project_id, NEW.base_revision, 'EXECUTING')
  ON CONFLICT (turn_id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER turns_create_operation AFTER INSERT ON public.turns FOR EACH ROW EXECUTE FUNCTION public.create_operation_for_turn();

CREATE OR REPLACE FUNCTION public.sync_operation_from_turn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.committed_revision IS NOT NULL AND OLD.committed_revision IS DISTINCT FROM NEW.committed_revision THEN
    UPDATE public.economic_operations SET committed_revision = NEW.committed_revision, settlement_state = 'COMMITTED' WHERE turn_id = NEW.id;
  END IF;
  IF NEW.status = 'aborted' AND OLD.status <> 'aborted' THEN
    UPDATE public.economic_operations SET settlement_state = 'CANCELLED' WHERE turn_id = NEW.id AND committed_revision IS NULL;
  ELSIF NEW.status = 'failed' AND OLD.status <> 'failed' THEN
    UPDATE public.economic_operations SET settlement_state = 'FAILED', outcome = COALESCE(outcome,'turn_failed') WHERE turn_id = NEW.id AND committed_revision IS NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER turns_sync_operation AFTER UPDATE ON public.turns FOR EACH ROW EXECUTE FUNCTION public.sync_operation_from_turn();

-- Backfill: every turn from the last 7 days (covers in-flight turns at deploy).
INSERT INTO public.economic_operations(turn_id, user_id, project_id, base_revision, committed_revision, settlement_state, metadata)
SELECT t.id, t.user_id, t.project_id, t.base_revision,
       CASE WHEN t.committed_revision > COALESCE(t.base_revision, -1) THEN t.committed_revision END,
       CASE WHEN t.status IN ('running','awaiting_credits') THEN 'EXECUTING'
            WHEN t.committed_revision IS NOT NULL THEN 'COMMITTED'
            WHEN t.status = 'aborted' THEN 'CANCELLED' ELSE 'FAILED' END,
       jsonb_build_object('backfilled', true)
FROM public.turns t WHERE t.created_at > now() - interval '7 days'
ON CONFLICT (turn_id) DO NOTHING;

-- Server helper: set the classified type once. Service role only.
CREATE OR REPLACE FUNCTION public.set_operation_type(_turn_id uuid, _type text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.economic_operations SET operation_type = _type WHERE turn_id = _turn_id AND operation_type = 'OTHER';
$$;
REVOKE EXECUTE ON FUNCTION public.set_operation_type(uuid, text) FROM PUBLIC, anon, authenticated;

-- ===== operation_id on every economic record =====
ALTER TABLE public.credit_ledger ADD COLUMN IF NOT EXISTS operation_id uuid REFERENCES public.economic_operations(id),
  ADD COLUMN IF NOT EXISTS credit_purpose text, ADD COLUMN IF NOT EXISTS attribution text;
ALTER TABLE public.project_builds ADD COLUMN IF NOT EXISTS operation_id uuid REFERENCES public.economic_operations(id),
  ADD COLUMN IF NOT EXISTS build_attempt integer, ADD COLUMN IF NOT EXISTS attribution text;
ALTER TABLE public.cost_events ADD COLUMN IF NOT EXISTS operation_id uuid REFERENCES public.economic_operations(id),
  ADD COLUMN IF NOT EXISTS attribution text;
ALTER TABLE public.turn_economics ADD COLUMN IF NOT EXISTS operation_id uuid REFERENCES public.economic_operations(id),
  ADD COLUMN IF NOT EXISTS operation_type text;
ALTER TABLE public.ai_call_log ADD COLUMN IF NOT EXISTS operation_id uuid REFERENCES public.economic_operations(id);
CREATE INDEX IF NOT EXISTS credit_ledger_operation_idx ON public.credit_ledger(operation_id);
CREATE INDEX IF NOT EXISTS project_builds_operation_idx ON public.project_builds(operation_id);
CREATE INDEX IF NOT EXISTS cost_events_operation_idx ON public.cost_events(operation_id);
CREATE INDEX IF NOT EXISTS ai_call_log_operation_idx ON public.ai_call_log(operation_id);

-- Exact resolver from a text turn id (never "latest").
CREATE OR REPLACE FUNCTION public.operation_for_turn_text(_turn text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM public.economic_operations
  WHERE _turn ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND turn_id = _turn::uuid
$$;

-- credit_ledger: build charges/refunds fail closed without an operation; identity immutable.
CREATE OR REPLACE FUNCTION public.credit_ledger_operation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
      RAISE EXCEPTION 'credit operation identity is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.reason IN ('ai_build_charge','ai_build_rollback_refund') AND NEW.operation_id IS NULL THEN
    RAISE EXCEPTION 'build credit record requires an economic operation (reason=%)', NEW.reason;
  END IF;
  NEW.attribution := CASE WHEN NEW.operation_id IS NOT NULL THEN 'OPERATION' ELSE 'SERVICE' END;
  RETURN NEW;
END; $$;
CREATE TRIGGER credit_ledger_operation_guard BEFORE INSERT OR UPDATE ON public.credit_ledger FOR EACH ROW EXECUTE FUNCTION public.credit_ledger_operation_guard();

-- One refund per charge, enforced from now on (3 historical duplicates predate this).
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_one_refund_per_charge
  ON public.credit_ledger ((metadata ->> 'refund_of_ledger'))
  WHERE delta > 0 AND metadata ? 'refund_of_ledger' AND created_at >= '2026-09-25 22:00:00+00';

-- project_builds: operation must match project and committed revision; immutable once set.
CREATE OR REPLACE FUNCTION public.project_builds_operation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE op public.economic_operations%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
    RAISE EXCEPTION 'build operation identity is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.turn_id IS NOT NULL AND NEW.turn_id IS DISTINCT FROM OLD.turn_id THEN
    NEW.turn_id := OLD.turn_id;
  END IF;
  IF NEW.operation_id IS NULL THEN
    NEW.attribution := 'unknown';
    RETURN NEW;
  END IF;
  SELECT * INTO op FROM public.economic_operations WHERE id = NEW.operation_id;
  IF op.project_id <> NEW.project_id THEN RAISE EXCEPTION 'build operation belongs to another project'; END IF;
  IF op.committed_revision IS NOT NULL AND NEW.project_revision IS NOT NULL AND NEW.project_revision <> op.committed_revision THEN
    RAISE EXCEPTION 'build revision % does not match operation committed revision %', NEW.project_revision, op.committed_revision;
  END IF;
  NEW.turn_id := op.turn_id::text;
  NEW.attribution := 'exact';
  RETURN NEW;
END; $$;
CREATE TRIGGER project_builds_operation_guard BEFORE INSERT OR UPDATE ON public.project_builds FOR EACH ROW EXECUTE FUNCTION public.project_builds_operation_guard();

-- AI calls, turn economics and cost events: exact link from their turn/build id; else marked unattributed.
CREATE OR REPLACE FUNCTION public.stamp_operation_from_turn() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.operation_id IS NULL AND NEW.turn_id IS NOT NULL THEN
    NEW.operation_id := public.operation_for_turn_text(NEW.turn_id::text);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ai_call_log_stamp_operation BEFORE INSERT OR UPDATE ON public.ai_call_log FOR EACH ROW EXECUTE FUNCTION public.stamp_operation_from_turn();
CREATE TRIGGER turn_economics_stamp_operation BEFORE INSERT OR UPDATE ON public.turn_economics FOR EACH ROW EXECUTE FUNCTION public.stamp_operation_from_turn();

CREATE OR REPLACE FUNCTION public.cost_events_stamp_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.operation_id IS NULL AND NEW.turn_id IS NOT NULL THEN
    NEW.operation_id := public.operation_for_turn_text(NEW.turn_id);
  END IF;
  IF NEW.operation_id IS NULL AND NEW.build_id IS NOT NULL THEN
    SELECT operation_id INTO NEW.operation_id FROM public.project_builds WHERE id = NEW.build_id;
  END IF;
  NEW.attribution := CASE WHEN NEW.operation_id IS NOT NULL THEN 'OPERATION'
                          WHEN NEW.user_id IS NULL AND NEW.project_id IS NULL THEN 'SHARED'
                          ELSE 'UNATTRIBUTED' END;
  RETURN NEW;
END; $$;
CREATE TRIGGER cost_events_stamp_operation BEFORE INSERT ON public.cost_events FOR EACH ROW EXECUTE FUNCTION public.cost_events_stamp_operation();

-- ===== spend_credit: free credits only for operations whose derived purpose is BUILD =====
DROP FUNCTION IF EXISTS public.spend_credit(uuid, numeric, text, uuid, jsonb);
CREATE OR REPLACE FUNCTION public.spend_credit(_user_id uuid, _amount numeric, _reason text DEFAULT 'ai_message'::text, _project_id uuid DEFAULT NULL::uuid, _metadata jsonb DEFAULT '{}'::jsonb, _operation_id uuid DEFAULT NULL::uuid)
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
  op public.economic_operations%ROWTYPE; purpose text := 'NON_BUILD';
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0 (got %)', _amount; END IF;
  _amount := round(_amount, 2);
  IF _operation_id IS NOT NULL THEN
    SELECT * INTO op FROM public.economic_operations WHERE id = _operation_id;
    IF NOT FOUND OR op.user_id <> _user_id OR (_project_id IS NOT NULL AND op.project_id <> _project_id) THEN
      RAISE EXCEPTION 'operation does not belong to this user/project';
    END IF;
    -- Purpose comes from the operation (server-derived allow-list), never the caller or the reason.
    purpose := public.operation_credit_purpose(op.operation_type, op.committed_revision IS NOT NULL);
  END IF;
  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN INSERT INTO public.user_wallets(user_id) VALUES (_user_id) RETURNING * INTO w; END IF;
  SELECT * INTO plan FROM public.billing_plans WHERE code = w.plan_code;
  IF w.daily_free_reset_at < today THEN w.daily_free_used := 0; w.daily_free_reset_at := today; END IF;
  IF w.monthly_free_reset_at < this_month THEN w.monthly_free_used := 0; w.monthly_free_reset_at := this_month; END IF;
  daily_avail := GREATEST(LEAST(COALESCE(plan.daily_free_credits,0),10) - w.daily_free_used, 0);
  monthly_cap_avail := GREATEST(LEAST(COALESCE(plan.monthly_free_cap,50),50) - w.monthly_free_used, 0);
  free_avail := CASE WHEN purpose = 'BUILD' AND public.is_build_credit_reason(_reason) THEN LEAST(daily_avail, monthly_cap_avail) ELSE 0 END;
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
  INSERT INTO public.credit_ledger(user_id, delta, reason, balance_after, project_id, metadata, operation_id, turn_id, credit_purpose)
  VALUES (_user_id, -_amount, _reason, new_balance, _project_id,
          _metadata || jsonb_build_object('sources', sources, 'free_build_credits', free_take, 'paid_credits', grant_take + topup_take),
          _operation_id, CASE WHEN _operation_id IS NOT NULL THEN op.turn_id END, purpose)
  RETURNING id INTO ledger_id;
  IF _operation_id IS NOT NULL THEN
    UPDATE public.economic_operations SET credits_charged = credits_charged + _amount,
      free_credits_charged = free_credits_charged + free_take, paid_credits_charged = paid_credits_charged + grant_take + topup_take
    WHERE id = _operation_id;
  END IF;
  RETURN ledger_id;
END; $function$;

-- ===== settle_build_charge: resolves the operation from the turn (server-side), sets type once =====
DROP FUNCTION IF EXISTS public.settle_build_charge(uuid, numeric, text, uuid, uuid, jsonb);
CREATE OR REPLACE FUNCTION public.settle_build_charge(_user_id uuid, _amount numeric, _reason text DEFAULT 'ai_build_charge'::text, _project_id uuid DEFAULT NULL::uuid, _turn_id uuid DEFAULT NULL::uuid, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(charged numeric, shortfall numeric, ledger_id uuid, idempotent boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE existing public.credit_ledger%ROWTYPE; op public.economic_operations%ROWTYPE;
  avail numeric(10,2); take numeric(10,2); short numeric(10,2); new_ledger uuid; t text;
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
  t := upper(COALESCE(_metadata ->> 'operation_type', ''));
  IF t IN ('FIRST_BUILD','ITERATION','DESIGN_SYSTEM_CHANGE','DEBUG_FIX','RETRY','RECOVERY','RESTORE','UNDO') THEN
    UPDATE public.economic_operations SET operation_type = t WHERE id = op.id AND operation_type = 'OTHER';
  END IF;
  UPDATE public.economic_operations SET credits_estimated = COALESCE(credits_estimated, NULLIF(_metadata ->> 'estimated_credits','')::numeric) WHERE id = op.id;
  IF _amount = 0 THEN RETURN QUERY SELECT 0::numeric(10,2), 0::numeric(10,2), NULL::uuid, false; RETURN; END IF;
  avail := COALESCE(public.available_credits(_user_id), 0);
  take  := LEAST(_amount, GREATEST(floor(avail * 100) / 100, 0));
  short := round(_amount - take, 2);
  IF take > 0 THEN
    new_ledger := public.spend_credit(_user_id, take, _reason, _project_id,
      _metadata || jsonb_build_object('priced_amount', _amount, 'shortfall', short), op.id);
    IF new_ledger IS NULL THEN take := 0; short := _amount; END IF;
  END IF;
  IF short > 0 THEN
    INSERT INTO public.user_wallets(user_id, credit_debt) VALUES (_user_id, short)
    ON CONFLICT (user_id) DO UPDATE SET credit_debt = public.user_wallets.credit_debt + EXCLUDED.credit_debt;
  END IF;
  RETURN QUERY SELECT take, short, new_ledger, false;
END; $function$;
REVOKE EXECUTE ON FUNCTION public.settle_build_charge(uuid, numeric, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.spend_credit(uuid, numeric, text, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- ===== Exact refund: only the charge of the build's own operation =====
DROP FUNCTION IF EXISTS public.refund_build_charge(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.refund_build_charge(_operation_id uuid, _build_id uuid, _reason text DEFAULT 'ai_build_rollback_refund'::text)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE charge public.credit_ledger%ROWTYPE; b public.project_builds%ROWTYPE; op public.economic_operations%ROWTYPE;
  proj_rev bigint; amt numeric(10,2); pay_debt numeric(10,2); give_back numeric(10,2); w public.user_wallets%ROWTYPE;
  src jsonb; bucket text; bamt numeric(10,2); split numeric(10,2) := 0;
BEGIN
  IF _operation_id IS NULL OR _build_id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO op FROM public.economic_operations WHERE id = _operation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT * INTO b FROM public.project_builds WHERE id = _build_id;
  IF NOT FOUND OR b.operation_id IS DISTINCT FROM _operation_id THEN RETURN 0; END IF;
  -- Delivered or already closed: never refund.
  IF b.status = 'ready' OR op.settlement_state IN ('READY','SETTLED','REFUNDED','CANCELLED') THEN RETURN 0; END IF;
  SELECT revision INTO proj_rev FROM public.projects WHERE id = op.project_id;
  IF b.project_revision IS NOT NULL AND proj_rev IS NOT NULL AND b.project_revision < proj_rev THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.project_builds o WHERE o.project_id = op.project_id AND o.id <> _build_id AND o.status = 'ready'
             AND o.project_revision IS NOT DISTINCT FROM b.project_revision AND b.project_revision IS NOT NULL) THEN RETURN 0; END IF;
  SELECT * INTO charge FROM public.credit_ledger c
   WHERE c.operation_id = _operation_id AND c.delta < 0 AND c.reason = 'ai_build_charge'
     AND NOT EXISTS (SELECT 1 FROM public.credit_ledger r WHERE r.delta > 0 AND ((r.metadata ->> 'refund_of_ledger') = c.id::text OR (r.metadata ->> 'refund_of') = c.id::text))
   LIMIT 1;
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
  INSERT INTO public.credit_ledger(user_id, delta, balance_after, reason, project_id, turn_id, operation_id, credit_purpose, metadata)
  VALUES (charge.user_id, amt, COALESCE(public.available_credits(charge.user_id), 0), _reason, op.project_id, op.turn_id, _operation_id, charge.credit_purpose,
          jsonb_build_object('refund_of_ledger', charge.id, 'build_id', _build_id, 'debt_cleared', pay_debt, 'sources', charge.metadata -> 'sources'));
  UPDATE public.economic_operations SET settlement_state = 'FAILED' WHERE id = _operation_id AND settlement_state IN ('COMMITTED','BUILDING','VERIFYING');
  UPDATE public.economic_operations SET settlement_state = 'REFUNDED', credits_refunded = credits_refunded + amt, outcome = 'refunded' WHERE id = _operation_id;
  RETURN amt;
END; $function$;
REVOKE EXECUTE ON FUNCTION public.refund_build_charge(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ===== Cohort stays OFF until the lifecycle architecture is verified =====
DROP TRIGGER IF EXISTS turn_economics_cohort ON public.turn_economics;

-- ===== Admin outcome & lifecycle economics =====
CREATE OR REPLACE FUNCTION public.operation_economics_report(_since timestamptz DEFAULT now() - interval '30 days')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb; credit_usd numeric := 0.13;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  WITH ops AS (
    SELECT o.*,
      COALESCE((SELECT sum(cost_usd) FROM public.cost_events c WHERE c.operation_id = o.id AND c.cost_basis = 'ACTUAL'), 0) AS cost_actual,
      COALESCE((SELECT sum(cost_usd) FROM public.cost_events c WHERE c.operation_id = o.id AND c.cost_basis = 'ESTIMATED'), 0) AS cost_estimated,
      COALESCE((SELECT sum(cost_usd) FROM public.cost_events c WHERE c.operation_id = o.id AND c.cost_basis = 'ALLOCATED'), 0) AS cost_allocated,
      (SELECT count(*) FROM public.cost_events c WHERE c.operation_id = o.id AND c.cost_basis = 'UNKNOWN') AS unknown_items,
      (o.settlement_state IN ('READY','SETTLED') AND o.credits_refunded = 0 AND o.committed_revision IS NOT NULL) AS success
    FROM public.economic_operations o WHERE o.created_at >= _since AND o.attribution = 'CUSTOMER'
  ), d AS (SELECT *, cost_actual + cost_estimated AS direct_cost, (credits_charged - credits_refunded) * credit_usd AS retained_usd FROM ops)
  SELECT jsonb_build_object(
    'credit_usd', credit_usd,
    'operations', (SELECT count(*) FROM d),
    'successful_outcomes', (SELECT count(*) FROM d WHERE success),
    'cost_per_successful_outcome', (SELECT CASE WHEN count(*) FILTER (WHERE success) > 0 THEN sum(direct_cost) / count(*) FILTER (WHERE success) END FROM d),
    'retained_revenue_per_successful_outcome', (SELECT CASE WHEN count(*) FILTER (WHERE success) > 0 THEN sum(retained_usd) / count(*) FILTER (WHERE success) END FROM d),
    'gross_profit_per_successful_outcome', (SELECT CASE WHEN count(*) FILTER (WHERE success) > 0 THEN (sum(retained_usd) - sum(direct_cost)) / count(*) FILTER (WHERE success) END FROM d),
    'failed_work_cost', (SELECT COALESCE(sum(direct_cost),0) FROM d WHERE NOT success),
    'refunded_cost', (SELECT COALESCE(sum(direct_cost),0) FROM d WHERE credits_refunded > 0),
    'success_rate', (SELECT CASE WHEN count(*) > 0 THEN count(*) FILTER (WHERE success)::numeric / count(*) END FROM d),
    'failure_rates', (SELECT jsonb_build_object(
        'customer_outcome', CASE WHEN count(*)>0 THEN count(*) FILTER (WHERE failure_class = 'customer_outcome')::numeric/count(*) END,
        'verification_only', CASE WHEN count(*)>0 THEN count(*) FILTER (WHERE failure_class = 'verification_only')::numeric/count(*) END,
        'infrastructure', CASE WHEN count(*)>0 THEN count(*) FILTER (WHERE failure_class = 'infrastructure')::numeric/count(*) END,
        'stale_callback', CASE WHEN count(*)>0 THEN count(*) FILTER (WHERE (metadata ->> 'stale_callbacks')::int > 0)::numeric/count(*) END) FROM d),
    'cost_basis_totals', (SELECT jsonb_build_object('actual', sum(cost_actual), 'estimated', sum(cost_estimated), 'allocated', sum(cost_allocated), 'unknown_items', sum(unknown_items)) FROM d),
    'by_type', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT operation_type, count(*) AS n, count(*) FILTER (WHERE success) AS successes,
          avg(direct_cost) AS avg_cost,
          CASE WHEN count(*) FILTER (WHERE success) > 0 THEN sum(direct_cost) / count(*) FILTER (WHERE success) END AS cost_per_success,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY direct_cost) AS p50,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY direct_cost) AS p75,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY direct_cost) AS p90,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY direct_cost) AS p95
        FROM d GROUP BY operation_type ORDER BY operation_type) x),
    'percentiles', (SELECT jsonb_build_object(
        'all', jsonb_build_array(percentile_cont(0.5) WITHIN GROUP (ORDER BY direct_cost), percentile_cont(0.75) WITHIN GROUP (ORDER BY direct_cost), percentile_cont(0.9) WITHIN GROUP (ORDER BY direct_cost), percentile_cont(0.95) WITHIN GROUP (ORDER BY direct_cost))) FROM d),
    'percentiles_successful', (SELECT jsonb_build_array(percentile_cont(0.5) WITHIN GROUP (ORDER BY direct_cost), percentile_cont(0.75) WITHIN GROUP (ORDER BY direct_cost), percentile_cont(0.9) WITHIN GROUP (ORDER BY direct_cost), percentile_cont(0.95) WITHIN GROUP (ORDER BY direct_cost)) FROM d WHERE success),
    'projects', (SELECT COALESCE(jsonb_agg(p ORDER BY p.operations DESC), '[]'::jsonb) FROM (
        SELECT project_id, count(*) AS operations, count(*) FILTER (WHERE success) AS successful, count(*) FILTER (WHERE NOT success) AS failed,
          sum(credits_charged - credits_refunded) AS credits_consumed, sum(retained_usd) AS retained_revenue,
          sum(direct_cost) AS direct_cost, COALESCE(sum(direct_cost) FILTER (WHERE NOT success),0) AS failed_work_cost,
          sum(credits_refunded) AS refunds, sum(retained_usd) - sum(direct_cost) AS gross_profit,
          CASE WHEN sum(retained_usd) > 0 THEN (sum(retained_usd) - sum(direct_cost)) / sum(retained_usd) END AS gross_margin,
          CASE WHEN count(*) FILTER (WHERE success) > 0 THEN sum(direct_cost) / count(*) FILTER (WHERE success) END AS cost_per_successful_operation
        FROM d GROUP BY project_id LIMIT 100) p)
  ) INTO result;
  RETURN result;
END; $$;
REVOKE EXECUTE ON FUNCTION public.operation_economics_report(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operation_economics_report(timestamptz) TO authenticated;