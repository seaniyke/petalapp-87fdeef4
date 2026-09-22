CREATE TABLE public.project_compute (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'railway',
  status TEXT NOT NULL DEFAULT 'pending',
  region TEXT,
  service_id TEXT,
  environment_id TEXT,
  service_url TEXT,
  last_active_at TIMESTAMP WITH TIME ZONE,
  awake_since TIMESTAMP WITH TIME ZONE,
  billed_through TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.project_compute TO authenticated;
GRANT ALL ON public.project_compute TO service_role;

ALTER TABLE public.project_compute ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their project compute"
ON public.project_compute FOR SELECT TO authenticated
USING (auth.uid() = owner_id);

CREATE TRIGGER update_project_compute_updated_at
BEFORE UPDATE ON public.project_compute
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_project_compute_status ON public.project_compute (status);

INSERT INTO public.economics_config (key, value)
VALUES ('compute_hour_usd', 0.08), ('max_active_compute', 25)
ON CONFLICT (key) DO NOTHING;