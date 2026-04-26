ALTER PUBLICATION supabase_realtime ADD TABLE public.project_builds;
ALTER TABLE public.project_builds REPLICA IDENTITY FULL;