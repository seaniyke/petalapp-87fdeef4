-- 1. Raw page views
CREATE TABLE public.page_views (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL DEFAULT '/',
  referrer TEXT,
  country TEXT,
  user_agent TEXT,
  visitor_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_day DATE GENERATED ALWAYS AS ((created_at AT TIME ZONE 'utc')::date) STORED
);

CREATE INDEX idx_page_views_project_created ON public.page_views(project_id, created_at DESC);
CREATE INDEX idx_page_views_project_visitor_day
  ON public.page_views(project_id, visitor_hash, created_day);

ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their project page views"
  ON public.page_views FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = page_views.project_id
        AND (p.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
    )
  );

-- 2. Daily rollup
CREATE TABLE public.page_views_daily (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  unique_visitors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, day)
);

CREATE INDEX idx_page_views_daily_project_day ON public.page_views_daily(project_id, day DESC);

ALTER TABLE public.page_views_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their daily rollup"
  ON public.page_views_daily FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = page_views_daily.project_id
        AND (p.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
    )
  );

-- 3. Public ingest helper
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
BEGIN
  IF _project_id IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id) THEN
    RETURN;
  END IF;

  IF _visitor_hash IS NOT NULL THEN
    _is_unique := NOT EXISTS (
      SELECT 1 FROM public.page_views
      WHERE project_id = _project_id
        AND visitor_hash = _visitor_hash
        AND created_day = _today
      LIMIT 1
    );
  END IF;

  INSERT INTO public.page_views (project_id, path, referrer, country, user_agent, visitor_hash)
  VALUES (_project_id, COALESCE(_path, '/'), _referrer, _country, _user_agent, _visitor_hash);

  INSERT INTO public.page_views_daily (project_id, day, views, unique_visitors)
  VALUES (_project_id, _today, 1, CASE WHEN _is_unique THEN 1 ELSE 0 END)
  ON CONFLICT (project_id, day) DO UPDATE
    SET views = public.page_views_daily.views + 1,
        unique_visitors = public.page_views_daily.unique_visitors
                          + CASE WHEN _is_unique THEN 1 ELSE 0 END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_page_view(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- 4. Stats reader
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
  IF NOT EXISTS (
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

GRANT EXECUTE ON FUNCTION public.get_project_pageview_stats(UUID) TO authenticated;