-- Extend credit_ledger.reason CHECK to allow the new "ai_coach_charge" reason
-- used by the Idea Coach feature (0.5 credit per coach turn, charged after success).
ALTER TABLE public.credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;

ALTER TABLE public.credit_ledger
  ADD CONSTRAINT credit_ledger_reason_check CHECK (
    reason = ANY (ARRAY[
      'ai_message'::text,
      'ai_image'::text,
      'ai_image_charge'::text,
      'ai_image_refund'::text,
      'ai_discuss'::text,
      'ai_discuss_charge'::text,
      'ai_discuss_refund'::text,
      'ai_build_hold'::text,
      'ai_build_topup'::text,
      'ai_build_charge'::text,
      'ai_build_refund'::text,
      'ai_build_credit'::text,
      'ai_message_refund'::text,
      'ai_coach_charge'::text,
      'daily_free'::text,
      'monthly_grant'::text,
      'topup'::text,
      'admin_grant'::text,
      'refund'::text,
      'rollover'::text,
      'signup_bonus'::text,
      'early_user_bonus'::text
    ])
  );