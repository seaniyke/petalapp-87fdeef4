DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'page_views_daily'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.page_views_daily;
  END IF;
END $$;

ALTER TABLE public.page_views_daily REPLICA IDENTITY FULL;