REVOKE EXECUTE ON FUNCTION public.cancel_paystack_plan(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_paystack_plan(uuid, text) TO service_role;