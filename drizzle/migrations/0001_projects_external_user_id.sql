ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS external_user_id text;
CREATE INDEX IF NOT EXISTS projects_owner_external_user_idx ON public.projects (owner_id, external_user_id) WHERE external_user_id IS NOT NULL;
COMMENT ON COLUMN public.projects.external_user_id IS 'Partner (Custard AI) customer id for API-created projects';