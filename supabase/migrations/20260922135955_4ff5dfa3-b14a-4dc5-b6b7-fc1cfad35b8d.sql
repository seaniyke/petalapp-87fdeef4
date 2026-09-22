ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cloud_tier_intent TEXT NOT NULL DEFAULT 'kimble';