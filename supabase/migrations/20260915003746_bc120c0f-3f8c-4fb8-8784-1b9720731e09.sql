ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS auto_upgrade_opt_out BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_upgrade_notified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.project_upgrade_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  rows_count INTEGER,
  users_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_upgrade_events_project_idx
  ON public.project_upgrade_events (project_id, created_at DESC);

GRANT SELECT ON public.project_upgrade_events TO authenticated;
GRANT ALL ON public.project_upgrade_events TO service_role;

ALTER TABLE public.project_upgrade_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their project upgrade events"
  ON public.project_upgrade_events
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_upgrade_events.project_id
      AND p.owner_id = auth.uid()
  ));

INSERT INTO public.economics_config (key, value)
VALUES
  ('auto_upgrade_row_pct', 80),
  ('auto_upgrade_user_count', 50),
  ('auto_upgrade_min_credits', 20)
ON CONFLICT (key) DO NOTHING;