CREATE OR REPLACE FUNCTION public.record_page_view(
  _project_id UUID,
  _path TEXT,
  _referrer TEXT,
  _country TEXT,
  _user_agent TEXT,
  _visitor_hash TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _today DATE := (now() AT TIME ZONE 'utc')::date;
  _is_unique BOOLEAN := false;
  _hash TEXT := NULLIF(_visitor_hash, '');
  _ref TEXT := NULLIF(_referrer, '');
  _country_clean TEXT := NULLIF(_country, '');
  _ua TEXT := NULLIF(_user_agent, '');
BEGIN
  IF _project_id IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id) THEN
    RETURN;
  END IF;

  IF _hash IS NOT NULL THEN
    _is_unique := NOT EXISTS (
      SELECT 1 FROM public.page_views
      WHERE project_id = _project_id
        AND visitor_hash = _hash
        AND created_day = _today
      LIMIT 1
    );
  END IF;

  INSERT INTO public.page_views (project_id, path, referrer, country, user_agent, visitor_hash)
  VALUES (_project_id, COALESCE(NULLIF(_path, ''), '/'), _ref, _country_clean, _ua, _hash);

  INSERT INTO public.page_views_daily (project_id, day, views, unique_visitors)
  VALUES (_project_id, _today, 1, CASE WHEN _is_unique THEN 1 ELSE 0 END)
  ON CONFLICT (project_id, day) DO UPDATE
    SET views = public.page_views_daily.views + 1,
        unique_visitors = public.page_views_daily.unique_visitors
                          + CASE WHEN _is_unique THEN 1 ELSE 0 END;
END;
$$;