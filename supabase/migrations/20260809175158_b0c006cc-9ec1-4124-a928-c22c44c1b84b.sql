-- 1) Projects: replace full-row public policy with a restricted view
DROP POLICY IF EXISTS "Anyone can view published public projects" ON public.projects;

CREATE OR REPLACE VIEW public.public_projects
WITH (security_invoker = false) AS
SELECT
  p.id,
  p.owner_id,
  p.title,
  p.summary,
  p.slug,
  p.subdomain,
  p.is_public,
  p.is_featured,
  p.remix_count,
  p.remixed_from_id,
  p.latest_build_id,
  p.published_build_id,
  p.published_visibility,
  p.published_at,
  p.primary_domain_id,
  p.hide_petal_badge,
  p.site_title,
  p.site_description,
  p.site_icon_url,
  p.site_og_image_url,
  p.created_at,
  p.updated_at
FROM public.projects p
WHERE p.is_public = true
  AND p.published_visibility = 'public';

GRANT SELECT ON public.public_projects TO anon, authenticated;

-- 2) Project builds: replace full-row public policy with a restricted view
DROP POLICY IF EXISTS "Published project builds are readable" ON public.project_builds;

CREATE OR REPLACE VIEW public.public_project_builds
WITH (security_invoker = false) AS
SELECT
  b.id,
  b.project_id,
  b.status,
  b.dist_path,
  b.ready_at,
  b.created_at
FROM public.project_builds b
JOIN public.projects p ON p.id = b.project_id
WHERE p.is_public = true
  AND p.published_visibility = 'public';

GRANT SELECT ON public.public_project_builds TO anon, authenticated;