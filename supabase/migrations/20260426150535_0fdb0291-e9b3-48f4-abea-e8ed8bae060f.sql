-- =========================================================================
-- Custom domains for projects
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- ---- table ---------------------------------------------------------------
CREATE TABLE public.project_domains (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  hostname citext NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verifying','active','failed','offline','removed')),
  is_primary boolean NOT NULL DEFAULT false,
  verification_txt_name text NOT NULL,
  verification_txt_value text NOT NULL,
  provider_hostname_id text,
  ssl_status text,
  last_checked_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- shape check: FQDN-ish, 1..253 chars, lowercase letters/digits/dot/hyphen
  CONSTRAINT project_domains_hostname_shape
    CHECK (
      length(hostname::text) BETWEEN 4 AND 253
      AND hostname::text ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    )
);

CREATE INDEX idx_project_domains_project ON public.project_domains(project_id);

-- At most one primary per project
CREATE UNIQUE INDEX idx_project_domains_one_primary
  ON public.project_domains(project_id)
  WHERE is_primary = true;

-- updated_at trigger (reuses existing helper)
CREATE TRIGGER trg_project_domains_updated_at
  BEFORE UPDATE ON public.project_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---- 5-domain cap per project -------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_project_domain_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.project_domains
   WHERE project_id = NEW.project_id;
  IF cnt >= 5 THEN
    RAISE EXCEPTION 'A project can have at most 5 connected domains';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_project_domains_cap
  BEFORE INSERT ON public.project_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_project_domain_cap();

-- ---- pointer on projects -------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN primary_domain_id uuid REFERENCES public.project_domains(id) ON DELETE SET NULL;

-- Keep projects.primary_domain_id in sync with project_domains.is_primary
CREATE OR REPLACE FUNCTION public.sync_project_primary_domain()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.is_primary = true THEN
    UPDATE public.projects
       SET primary_domain_id = NEW.id
     WHERE id = NEW.project_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.is_primary = true AND NEW.is_primary = false THEN
    UPDATE public.projects
       SET primary_domain_id = NULL
     WHERE id = NEW.project_id
       AND primary_domain_id = NEW.id;
  ELSIF TG_OP = 'DELETE' AND OLD.is_primary = true THEN
    UPDATE public.projects
       SET primary_domain_id = NULL
     WHERE id = OLD.project_id
       AND primary_domain_id = OLD.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_project_domains_sync_primary
  AFTER INSERT OR UPDATE OF is_primary OR DELETE ON public.project_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_project_primary_domain();

-- ---- RLS -----------------------------------------------------------------
ALTER TABLE public.project_domains ENABLE ROW LEVEL SECURITY;

-- Owners (and admins) can see their domains
CREATE POLICY "Owners can view their project domains"
  ON public.project_domains
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_domains.project_id
         AND (p.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
    )
  );

-- Owners can add a domain (status fields default to safe values; verification
-- nonces are generated client-side via gen_random_uuid())
CREATE POLICY "Owners can add project domains"
  ON public.project_domains
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_domains.project_id
         AND p.owner_id = auth.uid()
    )
  );

-- Owners can update only is_primary (status/SSL/verification mutated server-side)
CREATE POLICY "Owners can flip is_primary on their domains"
  ON public.project_domains
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_domains.project_id
         AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_domains.project_id
         AND p.owner_id = auth.uid()
    )
  );

-- Owners can remove their domains
CREATE POLICY "Owners can delete their project domains"
  ON public.project_domains
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_domains.project_id
         AND p.owner_id = auth.uid()
    )
  );

-- ---- realtime ------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_domains;
ALTER TABLE public.project_domains REPLICA IDENTITY FULL;