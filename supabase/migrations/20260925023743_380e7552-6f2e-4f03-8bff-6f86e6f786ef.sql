ALTER TABLE public.credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_reason_check CHECK (
  reason = ANY (ARRAY[
    'ai_message','ai_image','ai_image_charge','ai_image_refund','ai_discuss','ai_discuss_charge',
    'ai_discuss_refund','ai_build_hold','ai_build_topup','ai_build_charge','ai_build_refund',
    'ai_build_credit','ai_message_refund','ai_build_rollback_refund','duplicate_refund_reversal',
    'subscription_canceled','ai_coach_charge','ai_transcribe_charge','runtime_charge',
    'runtime_fallback','runtime_migration','daily_free','monthly_grant','topup','admin_grant',
    'refund','rollover','signup_bonus','early_user_bonus','badge_removal',
    'domain_purchase','mobile_build'
  ]::text[])
);

INSERT INTO public.economics_config (key, value, unit, description)
VALUES ('credit_retail_usd_cents', 20, 'usd_cents', 'USD cents of value assigned to one credit when charging a cash cost such as a domain')
ON CONFLICT (key) DO NOTHING;