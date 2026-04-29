CREATE TABLE IF NOT EXISTS public.project_secrets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_project_secrets_project ON public.project_secrets(project_id);

ALTER TABLE public.project_secrets ENABLE ROW LEVEL SECURITY;

-- Owners can see that a secret exists (name only) and delete it.
-- Insert/update happens via server-side admin client after fulfilment, so
-- no INSERT/UPDATE policy is granted to authenticated users.
CREATE POLICY "Owners read names of their project secrets"
ON public.project_secrets FOR SELECT
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_secrets.project_id AND p.owner_id = auth.uid()));

CREATE POLICY "Owners delete their project secrets"
ON public.project_secrets FOR DELETE
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_secrets.project_id AND p.owner_id = auth.uid()));

DROP TRIGGER IF EXISTS trg_project_secrets_touch ON public.project_secrets;
CREATE TRIGGER trg_project_secrets_touch BEFORE UPDATE ON public.project_secrets
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();