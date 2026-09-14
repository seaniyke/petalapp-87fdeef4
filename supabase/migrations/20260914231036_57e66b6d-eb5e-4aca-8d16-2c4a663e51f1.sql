ALTER TABLE public.credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;
ALTER TABLE public.credit_ledger
  ADD CONSTRAINT credit_ledger_reason_check CHECK (
    reason = ANY (ARRAY[
      'ai_message'::text,'ai_image'::text,'ai_image_charge'::text,'ai_image_refund'::text,
      'ai_discuss'::text,'ai_discuss_charge'::text,'ai_discuss_refund'::text,
      'ai_build_hold'::text,'ai_build_topup'::text,'ai_build_charge'::text,
      'ai_build_refund'::text,'ai_build_credit'::text,'ai_message_refund'::text,
      'ai_build_rollback_refund'::text,'duplicate_refund_reversal'::text,
      'subscription_canceled'::text,
      'ai_coach_charge'::text,'ai_transcribe_charge'::text,
      'runtime_charge'::text,'runtime_fallback'::text,'runtime_migration'::text,
      'daily_free'::text,'monthly_grant'::text,'topup'::text,'admin_grant'::text,
      'refund'::text,'rollover'::text,'signup_bonus'::text,'early_user_bonus'::text
    ])
  );

DO $$
DECLARE
  rate numeric := COALESCE(
    (SELECT value FROM public.economics_config WHERE key = 'target_variable_cost_per_credit_usd'),
    0.05
  );
  w RECORD;
  cents bigint;
  credits numeric;
BEGIN
  IF rate <= 0 THEN rate := 0.05; END IF;
  FOR w IN
    SELECT user_id,
           COALESCE(runtime_topup_balance_cents, 0) AS topup_cents,
           COALESCE(runtime_free_balance_cents, 0) AS free_cents,
           COALESCE(topup_credits_remaining, 0) AS credits_now
    FROM public.user_wallets
    WHERE COALESCE(runtime_topup_balance_cents, 0) > 0
       OR COALESCE(runtime_free_balance_cents, 0) > 0
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.credit_ledger
      WHERE user_id = w.user_id AND reason = 'runtime_migration'
    ) THEN
      CONTINUE;
    END IF;

    cents := w.topup_cents + w.free_cents;
    credits := ROUND((cents / 100.0) / rate, 2);
    IF credits <= 0 THEN CONTINUE; END IF;

    UPDATE public.user_wallets
       SET topup_credits_remaining = COALESCE(topup_credits_remaining, 0) + credits,
           runtime_topup_balance_cents = 0,
           runtime_free_balance_cents = 0,
           updated_at = now()
     WHERE user_id = w.user_id;

    INSERT INTO public.topup_lots (user_id, pack_code, credits_granted, credits_remaining, environment)
    VALUES (w.user_id, 'runtime_migration', credits, credits, 'live');

    INSERT INTO public.credit_ledger (user_id, delta, reason, balance_after, metadata)
    VALUES (
      w.user_id,
      credits,
      'runtime_migration',
      w.credits_now + credits,
      jsonb_build_object(
        'source', 'cloud_ai_wallet',
        'topup_cents', w.topup_cents,
        'free_cents', w.free_cents,
        'usd_per_credit', rate
      )
    );
  END LOOP;
END $$;