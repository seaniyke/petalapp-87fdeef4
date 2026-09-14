CREATE OR REPLACE FUNCTION public.runtime_cap_check(
  _user_id uuid,
  _project_id uuid,
  _amount_cents bigint
)
RETURNS TABLE(ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  w          public.user_wallets;
  proj_spent BIGINT := 0;
  ws_spent   BIGINT := 0;
BEGIN
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN QUERY SELECT true, 'noop';
    RETURN;
  END IF;

  SELECT * INTO w FROM public.user_wallets WHERE user_id = _user_id;

  IF _project_id IS NOT NULL THEN
    SELECT COALESCE(SUM(ABS(delta_cents)),0) INTO proj_spent
      FROM public.runtime_ledger
     WHERE project_id = _project_id
       AND delta_cents < 0
       AND created_at >= date_trunc('month', now());
    IF EXISTS (
      SELECT 1 FROM public.projects
       WHERE id = _project_id
         AND spend_cap_cents IS NOT NULL
         AND proj_spent + _amount_cents > spend_cap_cents
    ) THEN
      UPDATE public.projects SET runtime_paused = true WHERE id = _project_id;
      RETURN QUERY SELECT false, 'project_cap_exceeded';
      RETURN;
    END IF;
  END IF;

  IF w.workspace_cap_cents IS NOT NULL THEN
    SELECT COALESCE(SUM(ABS(delta_cents)),0) INTO ws_spent
      FROM public.runtime_ledger
     WHERE user_id = _user_id
       AND delta_cents < 0
       AND created_at >= date_trunc('month', now());
    IF ws_spent + _amount_cents > w.workspace_cap_cents THEN
      RETURN QUERY SELECT false, 'workspace_cap_exceeded';
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT true, 'ok';
END;
$function$;

REVOKE ALL ON FUNCTION public.runtime_cap_check(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_cap_check(uuid, uuid, bigint) TO service_role;