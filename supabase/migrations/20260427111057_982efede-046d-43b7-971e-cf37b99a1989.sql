-- Enable pgcrypto for encrypted credential storage
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- labs_flags: per-user feature toggles
-- =====================================================
CREATE TABLE public.labs_flags (
  user_id UUID NOT NULL PRIMARY KEY,
  flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.labs_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own labs flags"
  ON public.labs_flags FOR SELECT
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert their own labs flags"
  ON public.labs_flags FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update their own labs flags"
  ON public.labs_flags FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_labs_flags_updated_at
  BEFORE UPDATE ON public.labs_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- project_integrations: which integrations are installed per project
-- =====================================================
CREATE TABLE public.project_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  integration_code TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1',
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  installed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (project_id, integration_code)
);

CREATE INDEX idx_project_integrations_project ON public.project_integrations(project_id);

ALTER TABLE public.project_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their project integrations"
  ON public.project_integrations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = project_integrations.project_id
      AND (p.owner_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  ));

CREATE POLICY "Owners insert project integrations"
  ON public.project_integrations FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = project_integrations.project_id
      AND p.owner_id = auth.uid()
  ));

CREATE POLICY "Owners update project integrations"
  ON public.project_integrations FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = project_integrations.project_id
      AND p.owner_id = auth.uid()
  ));

CREATE POLICY "Owners delete project integrations"
  ON public.project_integrations FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = project_integrations.project_id
      AND p.owner_id = auth.uid()
  ));

CREATE TRIGGER update_project_integrations_updated_at
  BEFORE UPDATE ON public.project_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- project_integration_secrets: encrypted credentials (server-only)
-- =====================================================
CREATE TABLE public.project_integration_secrets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_integration_id UUID NOT NULL REFERENCES public.project_integrations(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (project_integration_id, field_id)
);

CREATE INDEX idx_project_integration_secrets_pi
  ON public.project_integration_secrets(project_integration_id);

ALTER TABLE public.project_integration_secrets ENABLE ROW LEVEL SECURITY;

-- NO public/authenticated policies — service role only.
-- The absence of policies means PostgREST returns nothing to authenticated/anon
-- callers. Server-side code uses the service role key (supabaseAdmin) to read/write.

CREATE TRIGGER update_project_integration_secrets_updated_at
  BEFORE UPDATE ON public.project_integration_secrets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();