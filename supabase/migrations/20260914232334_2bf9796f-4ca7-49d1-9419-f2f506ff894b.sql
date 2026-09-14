ALTER TABLE public.project_backends
  ADD COLUMN IF NOT EXISTS pause_reason TEXT,
  ADD COLUMN IF NOT EXISTS delete_warned_at TIMESTAMPTZ;

INSERT INTO public.economics_config (key, value)
VALUES ('max_active_dedicated_backends', 25), ('dedicated_retention_days', 30)
ON CONFLICT (key) DO NOTHING;