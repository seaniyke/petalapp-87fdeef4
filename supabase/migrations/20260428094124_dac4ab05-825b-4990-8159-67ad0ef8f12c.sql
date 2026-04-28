-- 1. New projects default to public
ALTER TABLE public.projects ALTER COLUMN is_public SET DEFAULT true;

-- 2. Backfill: flip every free-tier user's private projects to public.
-- Users with no wallet row yet are treated as free.
UPDATE public.projects p
SET is_public = true
WHERE is_public = false
  AND COALESCE(
    (SELECT w.plan_code FROM public.user_wallets w WHERE w.user_id = p.owner_id),
    'free'
  ) = 'free';

-- 3. Helper: is this user on a paid plan? (security definer so we can read
-- another user's wallet row from inside a trigger without RLS interference,
-- though here it's the row's own owner.)
CREATE OR REPLACE FUNCTION public.is_paid_plan(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT w.plan_code FROM public.user_wallets w WHERE w.user_id = _user_id),
    'free'
  ) <> 'free';
$$;

-- 4. Trigger: free users cannot make a project private.
-- Fires on INSERT (if they explicitly try to insert is_public=false) and on
-- UPDATE (if they try to flip a public project back to private).
-- Admins bypass.
CREATE OR REPLACE FUNCTION public.enforce_paid_for_private_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_public = false THEN
    -- Admin? Allow.
    IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
      RETURN NEW;
    END IF;
    -- Owner on paid plan? Allow.
    IF public.is_paid_plan(NEW.owner_id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only paid plans can make a project private. Upgrade to Pro to enable private projects.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_paid_for_private_project ON public.projects;
CREATE TRIGGER trg_enforce_paid_for_private_project
BEFORE INSERT OR UPDATE OF is_public ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.enforce_paid_for_private_project();