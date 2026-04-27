-- 1. Add the column (nullable — existing projects don't have a subdomain yet).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS subdomain text;

-- 2. Case-insensitive uniqueness. Using a unique index on lower() so we
--    never accidentally allow "Foo" + "foo".
CREATE UNIQUE INDEX IF NOT EXISTS projects_subdomain_unique_idx
  ON public.projects (lower(subdomain))
  WHERE subdomain IS NOT NULL;

-- 3. Validation trigger. Enforces format + reserved list. Lives in a
--    function so we can extend the rules later without an ALTER.
CREATE OR REPLACE FUNCTION public.validate_project_subdomain()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  reserved text[] := ARRAY[
    'www', 'api', 'admin', 'app', 'mail', 'email', 'ftp', 'smtp', 'pop',
    'imap', 'webmail', 'cpanel', 'whm', 'ns', 'ns1', 'ns2', 'mx', 'dns',
    'static', 'assets', 'cdn', 'docs', 'help', 'support', 'status',
    'blog', 'shop', 'store', 'pay', 'billing', 'auth', 'login', 'signup',
    'register', 'account', 'dashboard', 'console', 'portal', 'manage',
    'petal', 'buildwithpetal', 'lovable', 'about', 'contact', 'pricing',
    'terms', 'privacy', 'legal', 'security', 'changelog', 'roadmap',
    'preview', 'staging', 'dev', 'test', 'qa', 'demo', 'sandbox',
    'beta', 'alpha', 'edge', 'workers', 'pages', 'cf', 'cloudflare'
  ];
BEGIN
  -- Allow clearing the subdomain.
  IF NEW.subdomain IS NULL THEN
    RETURN NEW;
  END IF;

  -- Normalize to lowercase. We store as-given but compare lower().
  NEW.subdomain := lower(NEW.subdomain);

  -- Length: 3 to 40 chars (DNS label limit is 63, but keep marketing-friendly).
  IF length(NEW.subdomain) < 3 OR length(NEW.subdomain) > 40 THEN
    RAISE EXCEPTION 'Subdomain must be between 3 and 40 characters'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Format: lowercase letters, digits, hyphens. Cannot start or end with hyphen.
  IF NEW.subdomain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' THEN
    RAISE EXCEPTION 'Subdomain may only contain lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Reserved.
  IF NEW.subdomain = ANY(reserved) THEN
    RAISE EXCEPTION 'That subdomain is reserved. Please choose a different name.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_project_subdomain_trg ON public.projects;
CREATE TRIGGER validate_project_subdomain_trg
  BEFORE INSERT OR UPDATE OF subdomain ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_project_subdomain();

COMMENT ON COLUMN public.projects.subdomain IS
  'Unique slug used to publish this project at <slug>.buildwithpetal.com. Lowercase, 3-40 chars, [a-z0-9-]. Format + reserved-list validation lives in validate_project_subdomain trigger.';