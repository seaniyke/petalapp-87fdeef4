ALTER TABLE public.project_backends
  DROP CONSTRAINT IF EXISTS project_backends_provider_check;
ALTER TABLE public.project_backends
  ADD CONSTRAINT project_backends_provider_check
  CHECK (provider = ANY (ARRAY['byo_supabase'::text, 'managed_supabase'::text, 'managed_petal'::text]));

ALTER TABLE public.project_backends
  DROP CONSTRAINT IF EXISTS project_backends_status_check;
ALTER TABLE public.project_backends
  ADD CONSTRAINT project_backends_status_check
  CHECK (status = ANY (ARRAY['connecting'::text, 'ready'::text, 'failed'::text, 'paused'::text, 'provisioning'::text]));