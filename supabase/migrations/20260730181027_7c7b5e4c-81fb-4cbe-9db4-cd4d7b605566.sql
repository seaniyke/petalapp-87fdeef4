CREATE TABLE public.project_git_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'github',
  repo_full_name text NOT NULL,
  branch text NOT NULL DEFAULT 'main',
  access_token text NOT NULL,
  auto_sync boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  last_commit_sha text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.project_git_links TO service_role;

ALTER TABLE public.project_git_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "git links service role only"
ON public.project_git_links FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER update_project_git_links_updated_at
BEFORE UPDATE ON public.project_git_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();