DROP VIEW IF EXISTS public.public_project_builds;
DROP VIEW IF EXISTS public.public_projects;

CREATE OR REPLACE FUNCTION public.public_projects_list(p_limit integer DEFAULT 60)
RETURNS TABLE (
  id uuid, owner_id uuid, title text, summary text, slug text, subdomain text,
  is_public boolean, is_featured boolean, remix_count integer, remixed_from_id uuid,
  latest_build_id uuid, published_build_id uuid, published_visibility text,
  published_at timestamptz, primary_domain_id uuid, hide_petal_badge boolean,
  site_title text, site_description text, site_icon_url text, site_og_image_url text,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.owner_id, p.title, p.summary, p.slug, p.subdomain,
         p.is_public, p.is_featured, p.remix_count, p.remixed_from_id,
         p.latest_build_id, p.published_build_id, p.published_visibility,
         p.published_at, p.primary_domain_id, p.hide_petal_badge,
         p.site_title, p.site_description, p.site_icon_url, p.site_og_image_url,
         p.created_at, p.updated_at
  FROM public.projects p
  WHERE p.is_public = true
    AND p.published_visibility = 'public'
    AND p.published_build_id IS NOT NULL
    AND coalesce(p.title, '') NOT IN ('', 'Untitled project')
  ORDER BY p.is_featured DESC, p.remix_count DESC, p.updated_at DESC
  LIMIT least(greatest(coalesce(p_limit, 60), 1), 200)
$$;

CREATE OR REPLACE FUNCTION public.public_project_get(p_id uuid DEFAULT NULL, p_slug text DEFAULT NULL)
RETURNS TABLE (
  id uuid, owner_id uuid, title text, summary text, slug text, subdomain text,
  is_public boolean, is_featured boolean, remix_count integer, remixed_from_id uuid,
  latest_build_id uuid, published_build_id uuid, published_visibility text,
  published_at timestamptz, primary_domain_id uuid, hide_petal_badge boolean,
  site_title text, site_description text, site_icon_url text, site_og_image_url text,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.owner_id, p.title, p.summary, p.slug, p.subdomain,
         p.is_public, p.is_featured, p.remix_count, p.remixed_from_id,
         p.latest_build_id, p.published_build_id, p.published_visibility,
         p.published_at, p.primary_domain_id, p.hide_petal_badge,
         p.site_title, p.site_description, p.site_icon_url, p.site_og_image_url,
         p.created_at, p.updated_at
  FROM public.projects p
  WHERE p.is_public = true
    AND p.published_visibility = 'public'
    AND ((p_id IS NOT NULL AND p.id = p_id) OR (p_slug IS NOT NULL AND p.slug = p_slug))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.public_project_build_get(p_id uuid)
RETURNS TABLE (
  id uuid, project_id uuid, status text, dist_path text,
  ready_at timestamptz, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.project_id, b.status, b.dist_path, b.ready_at, b.created_at
  FROM public.project_builds b
  JOIN public.projects p ON p.id = b.project_id
  WHERE b.id = p_id
    AND p.is_public = true
    AND p.published_visibility = 'public'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.public_projects_list(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_project_get(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_project_build_get(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_projects_list(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_project_get(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_project_build_get(uuid) TO anon, authenticated, service_role;