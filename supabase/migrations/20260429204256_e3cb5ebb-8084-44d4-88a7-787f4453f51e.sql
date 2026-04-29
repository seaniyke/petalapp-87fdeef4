ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS site_title TEXT,
  ADD COLUMN IF NOT EXISTS site_description TEXT,
  ADD COLUMN IF NOT EXISTS site_icon_url TEXT,
  ADD COLUMN IF NOT EXISTS site_og_image_url TEXT;