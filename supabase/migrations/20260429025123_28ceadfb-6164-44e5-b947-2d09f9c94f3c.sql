
CREATE POLICY "Deny all client access" ON public.paystack_events
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

CREATE POLICY "Deny all client access" ON public.stripe_events
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

CREATE POLICY "Deny all client access" ON public.project_integration_secrets
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

DO $$
DECLARE
  fn text;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'admin_deduct_credits','admin_grant_credit','admin_grant_credits',
        'admin_list_transactions','admin_list_users','admin_refund_ledger',
        'admin_set_user_role',
        'apply_monthly_renewal','apply_paystack_backend_slot',
        'apply_paystack_domain_slot','apply_paystack_plan_grant',
        'apply_paystack_runtime_topup','apply_paystack_topup',
        'apply_period_end_changes','apply_subscription_activated',
        'apply_topup_purchase',
        'charge_runtime','credit_runtime','spend_credit','refund_credit',
        'grant_credits','runtime_apply_monthly_grant','set_user_plan',
        'expire_backend_slots','expire_domain_slots','expire_paystack_plans',
        'expire_topup_lots','reap_stalled_builds',
        'enqueue_email','read_email_batch','delete_email','move_to_dlq',
        'guard_is_featured','enforce_paid_for_private_project',
        'bump_remix_count','handle_new_user'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', fn);
  END LOOP;
END $$;
