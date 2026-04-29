-- 1) Recreate apply_paystack_runtime_topup with the correct column names
--    (runtime_ledger uses free_after_cents / topup_after_cents, not the
--    older free_balance_after / topup_balance_after).
CREATE OR REPLACE FUNCTION public.apply_paystack_runtime_topup(
  _user_id uuid,
  _reference text,
  _amount_cents bigint,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _was_qualified BOOLEAN;
  _w             public.user_wallets;
BEGIN
  -- Idempotency: only credit once per Paystack reference.
  IF EXISTS (
    SELECT 1 FROM public.runtime_ledger
     WHERE meter = 'topup'
       AND metadata ->> 'paystack_reference' = _reference
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.user_wallets (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT runtime_topup_qualified_at IS NOT NULL INTO _was_qualified
    FROM public.user_wallets WHERE user_id = _user_id;

  -- Credit the top-up.
  UPDATE public.user_wallets
     SET runtime_topup_balance_cents = runtime_topup_balance_cents + _amount_cents,
         updated_at = now()
   WHERE user_id = _user_id
  RETURNING * INTO _w;

  -- First-time top-up → mark qualified and grant the $5 free balance.
  IF NOT _was_qualified THEN
    UPDATE public.user_wallets
       SET runtime_topup_qualified_at = now(),
           runtime_free_balance_cents = 500,
           runtime_free_reset_at = (date_trunc('month', now()) + interval '1 month')::date
     WHERE user_id = _user_id
    RETURNING * INTO _w;

    INSERT INTO public.runtime_ledger
      (user_id, project_id, meter, delta_cents, free_after_cents, topup_after_cents, metadata)
    SELECT _user_id, NULL, 'free_grant', 500,
           runtime_free_balance_cents, runtime_topup_balance_cents,
           jsonb_build_object('source','first_topup_grant')
      FROM public.user_wallets WHERE user_id = _user_id;
  END IF;

  -- Record the top-up itself.
  INSERT INTO public.runtime_ledger
    (user_id, project_id, meter, delta_cents, free_after_cents, topup_after_cents, metadata)
  VALUES
    (_user_id, NULL, 'topup', _amount_cents,
     _w.runtime_free_balance_cents, _w.runtime_topup_balance_cents,
     _metadata || jsonb_build_object('paystack_reference', _reference));

  -- Top-up clears any active grace windows on this user's projects.
  UPDATE public.projects
     SET runtime_grace_until = NULL,
         runtime_paused = false
   WHERE owner_id = _user_id
     AND (runtime_grace_until IS NOT NULL OR runtime_paused = true);
END;
$function$;

-- 2) Heal the affected user's two real successful top-ups.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM public.paystack_transactions
     WHERE reference IN (
       'pt_3811e78377884d45b13ea365a76815d0',
       'pt_d613e1aafbb04a3a9fdf4c985dc10a7d'
     )
       AND status = 'pending'
  LOOP
    PERFORM public.apply_paystack_runtime_topup(
      r.user_id,
      r.reference,
      r.usd_amount_cents,
      jsonb_build_object(
        'item_code', r.item_code,
        'currency_code', r.currency_code,
        'amount_minor', r.amount_minor,
        'environment', r.environment,
        'healed_by', 'manual-support-2026-04-29'
      )
    );
    UPDATE public.paystack_transactions
       SET status='success',
           paystack_reference = r.reference,
           channel = 'bank_transfer',
           paid_at = now()
     WHERE id = r.id AND status = 'pending';
  END LOOP;

  -- Mark the two abandoned card attempts as abandoned.
  UPDATE public.paystack_transactions
     SET status = 'abandoned'
   WHERE reference IN (
     'pt_28fc9b5d6c2e438e8f609b85ca445315',
     'pt_224b6ca26224478d8e0aa192bcef7a3c'
   )
     AND status = 'pending';
END $$;