ALTER TABLE public.credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_reason_check CHECK (reason = ANY (ARRAY['ai_message','ai_image','ai_image_charge','ai_image_refund','ai_discuss','ai_discuss_charge','ai_discuss_refund','ai_build_hold','ai_build_topup','ai_build_charge','ai_build_refund','ai_build_credit','ai_message_refund','ai_build_rollback_refund','duplicate_refund_reversal','subscription_canceled','ai_coach_charge','ai_transcribe_charge','runtime_charge','runtime_fallback','runtime_migration','daily_free','monthly_grant','topup','admin_grant','refund','rollover','signup_bonus','early_user_bonus','badge_removal']::text[]));

CREATE TABLE public.project_badge_removals (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  ledger_id uuid,
  credits numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.project_badge_removals TO authenticated;
GRANT ALL ON public.project_badge_removals TO service_role;
ALTER TABLE public.project_badge_removals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners see their badge removals" ON public.project_badge_removals FOR SELECT TO authenticated USING (user_id = auth.uid());

INSERT INTO public.economics_config (key, value)
SELECT 'badge_removal_credits', 25
WHERE NOT EXISTS (SELECT 1 FROM public.economics_config WHERE key = 'badge_removal_credits');