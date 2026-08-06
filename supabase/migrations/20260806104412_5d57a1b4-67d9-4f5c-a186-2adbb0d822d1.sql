-- 1. Turn lifecycle sweeper ---------------------------------------------

CREATE OR REPLACE FUNCTION public.reap_stalled_turns()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.turns
     SET status = 'aborted',
         ended_at = COALESCE(ended_at, now()),
         error_message = COALESCE(error_message, 'stale: no terminal write')
   WHERE status = 'running'
     AND started_at < now() - interval '15 minutes';
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stalled_turns() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stalled_turns() TO service_role;

SELECT cron.schedule('reap-stalled-turns', '* * * * *', 'SELECT public.reap_stalled_turns();');

-- Backfill the existing zombies immediately so metrics start clean.
UPDATE public.turns
   SET status = 'aborted',
       ended_at = COALESCE(ended_at, started_at + interval '15 minutes'),
       error_message = COALESCE(error_message, 'stale: no terminal write (backfill)')
 WHERE status = 'running'
   AND started_at < now() - interval '15 minutes';

-- 2. Idempotent build settlement ----------------------------------------

ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS turn_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_turn_id_key
  ON public.credit_ledger (turn_id)
  WHERE turn_id IS NOT NULL;

ALTER TABLE public.user_wallets
  ADD COLUMN IF NOT EXISTS credit_debt numeric(10,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.settle_build_charge(
  _user_id uuid,
  _amount numeric,
  _reason text DEFAULT 'ai_build_charge',
  _project_id uuid DEFAULT NULL,
  _turn_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(charged numeric, shortfall numeric, ledger_id uuid, idempotent boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing   public.credit_ledger%ROWTYPE;
  avail      numeric(10,2);
  take       numeric(10,2);
  short      numeric(10,2);
  new_ledger uuid;
BEGIN
  _amount := round(GREATEST(COALESCE(_amount, 0), 0), 2);

  -- Idempotency: one turn can only ever be settled once.
  IF _turn_id IS NOT NULL THEN
    SELECT * INTO existing FROM public.credit_ledger WHERE turn_id = _turn_id LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT ABS(existing.amount)::numeric(10,2), 0::numeric(10,2), existing.id, true;
      RETURN;
    END IF;
  END IF;

  IF _amount = 0 THEN
    RETURN QUERY SELECT 0::numeric(10,2), 0::numeric(10,2), NULL::uuid, false;
    RETURN;
  END IF;

  avail := COALESCE(public.available_credits(_user_id), 0);
  take  := LEAST(_amount, GREATEST(floor(avail * 100) / 100, 0));
  short := round(_amount - take, 2);

  IF take > 0 THEN
    new_ledger := public.spend_credit(
      _user_id,
      take,
      _reason,
      _project_id,
      _metadata || jsonb_build_object('priced_amount', _amount, 'shortfall', short)
    );
    IF new_ledger IS NOT NULL AND _turn_id IS NOT NULL THEN
      UPDATE public.credit_ledger SET turn_id = _turn_id WHERE id = new_ledger;
    END IF;
    IF new_ledger IS NULL THEN
      -- Race: balance moved between read and spend. Treat the whole bill as debt.
      take := 0;
      short := _amount;
    END IF;
  END IF;

  IF short > 0 THEN
    INSERT INTO public.user_wallets(user_id, credit_debt)
    VALUES (_user_id, short)
    ON CONFLICT (user_id) DO UPDATE
      SET credit_debt = public.user_wallets.credit_debt + EXCLUDED.credit_debt;
  END IF;

  RETURN QUERY SELECT take, short, new_ledger, false;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_build_charge(uuid, numeric, text, uuid, uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_build_charge(uuid, numeric, text, uuid, uuid, jsonb) TO service_role;