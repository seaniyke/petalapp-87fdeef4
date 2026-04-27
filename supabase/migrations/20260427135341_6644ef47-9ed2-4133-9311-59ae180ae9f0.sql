REVOKE EXECUTE ON FUNCTION public.admin_list_users(text, int, int) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_grant_credits(uuid, numeric, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_deduct_credits(uuid, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, app_role, boolean) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_refund_ledger(uuid, uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_list_transactions(text, text, text, int, int) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.admin_list_users(text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_credits(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deduct_credits(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, app_role, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_ledger(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_transactions(text, text, text, int, int) TO authenticated;