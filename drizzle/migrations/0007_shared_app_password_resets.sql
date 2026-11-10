CREATE TABLE public.shared_app_password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.shared_app_password_resets TO service_role;
ALTER TABLE public.shared_app_password_resets ENABLE ROW LEVEL SECURITY;
CREATE INDEX shared_app_password_resets_user ON public.shared_app_password_resets (project_id, user_id, created_at DESC);
CREATE INDEX shared_app_password_resets_project ON public.shared_app_password_resets (project_id, created_at DESC);