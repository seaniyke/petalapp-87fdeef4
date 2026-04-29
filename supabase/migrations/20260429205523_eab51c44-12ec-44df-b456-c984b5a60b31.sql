CREATE OR REPLACE FUNCTION public.get_project_pageview_stats(_project_id UUID)
RETURNS TABLE(
  views_24h BIGINT,
  views_7d BIGINT,
  views_30d BIGINT,
  visitors_7d BIGINT,
  visitors_30d BIGINT
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.projects p
       WHERE p.id = _project_id
         AND (p.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
     ) THEN
    RAISE EXCEPTION 'Not authorized to read stats for this project';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.page_views
       WHERE project_id = _project_id AND created_at >= now() - interval '24 hours'),
    (SELECT COALESCE(SUM(views),0) FROM public.page_views_daily
       WHERE project_id = _project_id AND day >= (now() AT TIME ZONE 'utc')::date - 6),
    (SELECT COALESCE(SUM(views),0) FROM public.page_views_daily
       WHERE project_id = _project_id AND day >= (now() AT TIME ZONE 'utc')::date - 29),
    (SELECT COALESCE(SUM(unique_visitors),0) FROM public.page_views_daily
       WHERE project_id = _project_id AND day >= (now() AT TIME ZONE 'utc')::date - 6),
    (SELECT COALESCE(SUM(unique_visitors),0) FROM public.page_views_daily
       WHERE project_id = _project_id AND day >= (now() AT TIME ZONE 'utc')::date - 29);
END;
$$;