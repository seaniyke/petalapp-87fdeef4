-- Phase 2: Preview vs Production split.
-- Add columns to track which build is currently published to public visitors,
-- separate from `latest_build_id` (which always points at the most recent
-- preview build the AI generates).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS published_build_id uuid,
  ADD COLUMN IF NOT EXISTS published_visibility text NOT NULL DEFAULT 'unpublished',
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Constrain visibility to a known set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_published_visibility_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_published_visibility_check
      CHECK (published_visibility IN ('public', 'private', 'unpublished'));
  END IF;
END $$;

-- Index the lookup we'll do on every public asset request through host-routing.
CREATE INDEX IF NOT EXISTS projects_published_build_id_idx
  ON public.projects (published_build_id)
  WHERE published_build_id IS NOT NULL;
