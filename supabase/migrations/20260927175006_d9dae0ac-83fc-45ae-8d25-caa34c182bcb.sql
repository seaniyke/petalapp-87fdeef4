-- Billing-related SECURITY DEFINER functions must be server-only.
-- apply_paystack_marketplace_purchase was callable by anyone (fake purchases/earnings);
-- available_credits / check_credit_balance let any signed-in user read another user's balance;
-- marketplace_record_earning / marketplace_bump_sales are trigger functions (triggers still fire).
REVOKE EXECUTE ON FUNCTION public.apply_paystack_marketplace_purchase(uuid, text, text, bigint, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.available_credits(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_credit_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketplace_record_earning() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marketplace_bump_sales() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paystack_marketplace_purchase(uuid, text, text, bigint, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.available_credits(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_credit_balance(uuid, numeric) TO service_role;