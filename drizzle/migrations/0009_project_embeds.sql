CREATE TABLE public.project_embeds (
  id text PRIMARY KEY,
  project_id uuid NOT NULL,
  allowed_origin text NOT NULL,
  created_by_key uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_embeds_project_idx ON public.project_embeds(project_id, created_at DESC);
GRANT ALL ON public.project_embeds TO service_role;
ALTER TABLE public.project_embeds ENABLE ROW LEVEL SECURITY;