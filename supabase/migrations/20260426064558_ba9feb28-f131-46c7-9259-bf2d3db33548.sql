-- 1. New columns on projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS remix_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remixed_from_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_public_featured ON public.projects (is_public, is_featured, remix_count DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_remixed_from ON public.projects (remixed_from_id);

-- 2. Trigger to bump remix_count on the source project
CREATE OR REPLACE FUNCTION public.bump_remix_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.remixed_from_id IS NOT NULL THEN
    UPDATE public.projects
       SET remix_count = remix_count + 1
     WHERE id = NEW.remixed_from_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_remix_count ON public.projects;
CREATE TRIGGER trg_bump_remix_count
AFTER INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.bump_remix_count();

-- 3. Admin-only featured update policy.
-- Existing "Owners can update their projects" policy keeps owners able to edit their own rows,
-- but cannot set is_featured on other people's rows. Admins get a separate ALL policy.
DROP POLICY IF EXISTS "Admins can update any project" ON public.projects;
CREATE POLICY "Admins can update any project"
ON public.projects
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. Prevent non-admin owners from flipping is_featured on their own projects via a trigger guard.
CREATE OR REPLACE FUNCTION public.guard_is_featured()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_featured IS DISTINCT FROM OLD.is_featured
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change is_featured';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_is_featured ON public.projects;
CREATE TRIGGER trg_guard_is_featured
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.guard_is_featured();