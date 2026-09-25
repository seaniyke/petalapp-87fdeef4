ALTER TABLE public.generated_pictures
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS visual_traits text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS provider text;
CREATE INDEX IF NOT EXISTS generated_pictures_project_idx ON public.generated_pictures (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generated_pictures_cache_key_idx ON public.generated_pictures (cache_key);