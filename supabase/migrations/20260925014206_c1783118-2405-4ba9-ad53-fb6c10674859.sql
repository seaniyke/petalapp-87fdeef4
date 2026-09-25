CREATE TABLE public.generated_pictures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  cache_key TEXT,
  prompt TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  style TEXT,
  mood TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  aspect_ratio TEXT NOT NULL DEFAULT '',
  orientation TEXT NOT NULL DEFAULT '',
  model TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  owner_id UUID,
  turn_id UUID,
  shared BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.generated_pictures TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_pictures TO authenticated;
GRANT ALL ON public.generated_pictures TO service_role;

ALTER TABLE public.generated_pictures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their own generated pictures"
  ON public.generated_pictures FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Anyone signed in reads shared generated pictures"
  ON public.generated_pictures FOR SELECT TO authenticated
  USING (shared = true AND active = true);

CREATE POLICY "Admins read all generated pictures"
  ON public.generated_pictures FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage generated pictures"
  ON public.generated_pictures FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete generated pictures"
  ON public.generated_pictures FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX generated_pictures_tags_idx ON public.generated_pictures USING GIN (tags);
CREATE INDEX generated_pictures_owner_idx ON public.generated_pictures (owner_id, created_at DESC);
CREATE INDEX generated_pictures_project_idx ON public.generated_pictures (project_id, created_at DESC);
CREATE INDEX generated_pictures_shared_idx ON public.generated_pictures (shared) WHERE shared = true;

CREATE TRIGGER update_generated_pictures_updated_at
  BEFORE UPDATE ON public.generated_pictures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();