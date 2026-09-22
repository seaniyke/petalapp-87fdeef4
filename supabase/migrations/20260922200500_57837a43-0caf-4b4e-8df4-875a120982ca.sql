CREATE TABLE public.design_pictures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  subject TEXT NOT NULL,
  industry TEXT,
  mood TEXT,
  tone TEXT,
  colors TEXT[] NOT NULL DEFAULT '{}',
  orientation TEXT NOT NULL DEFAULT 'landscape',
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  has_people BOOLEAN NOT NULL DEFAULT false,
  style TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'curated',
  license TEXT NOT NULL DEFAULT 'unknown',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.design_pictures TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.design_pictures TO authenticated;
GRANT ALL ON public.design_pictures TO service_role;

ALTER TABLE public.design_pictures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active pictures are readable"
  ON public.design_pictures FOR SELECT
  USING (active OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert pictures"
  ON public.design_pictures FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update pictures"
  ON public.design_pictures FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete pictures"
  ON public.design_pictures FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX design_pictures_active_idx ON public.design_pictures (active);
CREATE INDEX design_pictures_tags_idx ON public.design_pictures USING GIN (tags);
CREATE INDEX design_pictures_industry_idx ON public.design_pictures (industry);

CREATE TRIGGER update_design_pictures_updated_at
  BEFORE UPDATE ON public.design_pictures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();