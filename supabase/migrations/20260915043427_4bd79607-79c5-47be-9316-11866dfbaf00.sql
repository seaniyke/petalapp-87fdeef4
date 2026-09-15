CREATE TABLE public.project_thumbnails (
  project_id UUID NOT NULL PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  build_id UUID,
  url TEXT NOT NULL,
  storage_path TEXT,
  width INTEGER,
  height INTEGER,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.project_thumbnails TO anon;
GRANT SELECT ON public.project_thumbnails TO authenticated;
GRANT ALL ON public.project_thumbnails TO service_role;

ALTER TABLE public.project_thumbnails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Saved previews are readable by anyone"
  ON public.project_thumbnails
  FOR SELECT
  USING (true);

CREATE TRIGGER update_project_thumbnails_updated_at
  BEFORE UPDATE ON public.project_thumbnails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();