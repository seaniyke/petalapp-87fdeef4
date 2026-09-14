CREATE OR REPLACE FUNCTION public.enforce_paid_for_private_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_public = false THEN
    IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
      RETURN NEW;
    END IF;
    IF public.is_paid_plan(NEW.owner_id) THEN
      RETURN NEW;
    END IF;
    -- Free accounts: a brand-new project simply starts shareable rather than
    -- failing to be created at all. Deliberately turning an existing project
    -- private still requires a paid plan.
    IF TG_OP = 'INSERT' THEN
      NEW.is_public := true;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only paid plans can make a project private. Upgrade to Pro to enable private projects.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;