CREATE TABLE public.shared_backends (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  api_key text NOT NULL UNIQUE,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.shared_backends TO service_role;
ALTER TABLE public.shared_backends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shared_backends owner read" ON public.shared_backends FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

CREATE TABLE public.shared_app_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  collection text NOT NULL,
  owner_key text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shared_app_records_project_collection_idx ON public.shared_app_records (project_id, collection, created_at DESC);
CREATE INDEX shared_app_records_owner_idx ON public.shared_app_records (project_id, collection, owner_key);
GRANT ALL ON public.shared_app_records TO service_role;
ALTER TABLE public.shared_app_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shared_app_records owner read" ON public.shared_app_records FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

CREATE TABLE public.shared_app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email citext NOT NULL,
  password_hash text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);
GRANT ALL ON public.shared_app_users TO service_role;
ALTER TABLE public.shared_app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shared_app_users owner read" ON public.shared_app_users FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

CREATE TRIGGER update_shared_backends_updated_at BEFORE UPDATE ON public.shared_backends
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_shared_app_records_updated_at BEFORE UPDATE ON public.shared_app_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_shared_app_users_updated_at BEFORE UPDATE ON public.shared_app_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();