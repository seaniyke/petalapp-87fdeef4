ALTER TABLE public.projects ADD COLUMN backend_type text NOT NULL DEFAULT 'shared' CHECK (backend_type IN ('shared', 'dedicated'));
ALTER TABLE public.project_backends ADD COLUMN last_active_at timestamp with time zone;
ALTER TABLE public.project_backends DROP CONSTRAINT IF EXISTS project_backends_provider_check;
ALTER TABLE public.project_backends ADD CONSTRAINT project_backends_provider_check CHECK (provider = ANY (ARRAY['byo_supabase'::text, 'managed_supabase'::text, 'managed_petal'::text, 'shared_petal'::text]));

CREATE INDEX IF NOT EXISTS idx_project_backends_last_active ON public.project_backends(last_active_at) WHERE provider = 'managed_petal';
GRANT ALL ON public.projects TO service_role;
GRANT ALL ON public.project_backends TO service_role;