CREATE TABLE public.developer_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_label text,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['projects:read','projects:write']::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
GRANT ALL ON public.developer_api_keys TO service_role;
ALTER TABLE public.developer_api_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.developer_key_projects (
  key_id uuid NOT NULL REFERENCES public.developer_api_keys(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, project_id)
);
CREATE INDEX developer_key_projects_project_idx ON public.developer_key_projects(project_id);
GRANT ALL ON public.developer_key_projects TO service_role;
ALTER TABLE public.developer_key_projects ENABLE ROW LEVEL SECURITY;