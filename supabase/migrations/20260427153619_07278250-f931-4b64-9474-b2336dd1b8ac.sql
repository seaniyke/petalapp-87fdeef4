REVOKE ALL ON FUNCTION public.reap_stalled_builds() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reap_stalled_builds() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stalled_builds() TO postgres;
