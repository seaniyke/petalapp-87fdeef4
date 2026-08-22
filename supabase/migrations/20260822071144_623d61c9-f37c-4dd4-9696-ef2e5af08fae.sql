-- ============ LICENSES ============
CREATE TABLE public.marketplace_licenses (
  code text PRIMARY KEY,
  name text NOT NULL,
  summary text NOT NULL,
  rights text[] NOT NULL DEFAULT '{}',
  resale_allowed boolean NOT NULL DEFAULT false,
  white_label_allowed boolean NOT NULL DEFAULT false,
  redistribute_allowed boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.marketplace_licenses TO anon;
GRANT SELECT ON public.marketplace_licenses TO authenticated;
GRANT ALL ON public.marketplace_licenses TO service_role;

ALTER TABLE public.marketplace_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "licenses readable by everyone"
  ON public.marketplace_licenses FOR SELECT
  USING (true);

CREATE POLICY "admins manage licenses"
  ON public.marketplace_licenses FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.marketplace_licenses (code, name, summary, rights, resale_allowed, white_label_allowed, redistribute_allowed, sort_order) VALUES
  ('personal', 'Personal use',
   'Use this product for your own personal or learning projects. You may customize it in Petal and deploy it for yourself.',
   ARRAY['Open and customize in Petal','Deploy for personal use','Unlimited edits'],
   false, false, false, 1),
  ('commercial', 'Commercial use',
   'Use this product in one commercial project for you or a client. You may customize it in Petal and deploy it publicly.',
   ARRAY['Everything in Personal use','Use in one commercial project','Deploy publicly for a business or client'],
   false, false, false, 2),
  ('extended', 'Extended use',
   'Use this product across unlimited commercial projects and ship it under your own brand.',
   ARRAY['Everything in Commercial use','Unlimited commercial projects','Ship under your own brand'],
   false, true, false, 3);

-- ============ LISTINGS ============
CREATE TABLE public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  pitch text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'app',
  screenshots text[] NOT NULL DEFAULT '{}',
  cover_url text,
  demo_url text,
  price_minor bigint NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'USD',
  license_code text NOT NULL DEFAULT 'personal' REFERENCES public.marketplace_licenses(code),
  status text NOT NULL DEFAULT 'draft',
  review_note text,
  source_version_id uuid REFERENCES public.project_versions(id) ON DELETE SET NULL,
  source_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  file_count int NOT NULL DEFAULT 0,
  open_count int NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_listings_status_check
    CHECK (status IN ('draft','in_review','live','delisted','rejected')),
  CONSTRAINT marketplace_listings_price_check CHECK (price_minor >= 0)
);

CREATE INDEX marketplace_listings_status_idx ON public.marketplace_listings (status, published_at DESC);
CREATE INDEX marketplace_listings_creator_idx ON public.marketplace_listings (creator_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_listings TO authenticated;
GRANT ALL ON public.marketplace_listings TO service_role;

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "creators read own listings"
  ON public.marketplace_listings FOR SELECT
  TO authenticated
  USING (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "creators insert own listings"
  ON public.marketplace_listings FOR INSERT
  TO authenticated
  WITH CHECK (
    creator_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "creators update own listings"
  ON public.marketplace_listings FOR UPDATE
  TO authenticated
  USING (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "creators delete own listings"
  ON public.marketplace_listings FOR DELETE
  TO authenticated
  USING (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER marketplace_listings_touch
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ PUBLIC DISCOVERY ============
CREATE OR REPLACE FUNCTION public.marketplace_list_live()
RETURNS TABLE (
  id uuid, slug text, title text, pitch text, category text,
  cover_url text, screenshots text[], demo_url text,
  price_minor bigint, currency_code text, license_code text,
  open_count int, file_count int, published_at timestamptz, creator_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.slug, l.title, l.pitch, l.category,
         l.cover_url, l.screenshots, l.demo_url,
         l.price_minor, l.currency_code, l.license_code,
         l.open_count, l.file_count, l.published_at, l.creator_id
  FROM public.marketplace_listings l
  WHERE l.status = 'live'
  ORDER BY l.published_at DESC NULLS LAST
  LIMIT 200
$$;

GRANT EXECUTE ON FUNCTION public.marketplace_list_live() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_get_live(p_slug text)
RETURNS TABLE (
  id uuid, slug text, title text, pitch text, description text, category text,
  cover_url text, screenshots text[], demo_url text,
  price_minor bigint, currency_code text, license_code text,
  open_count int, file_count int, published_at timestamptz, creator_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.slug, l.title, l.pitch, l.description, l.category,
         l.cover_url, l.screenshots, l.demo_url,
         l.price_minor, l.currency_code, l.license_code,
         l.open_count, l.file_count, l.published_at, l.creator_id
  FROM public.marketplace_listings l
  WHERE l.status = 'live' AND l.slug = p_slug
$$;

GRANT EXECUTE ON FUNCTION public.marketplace_get_live(text) TO anon, authenticated;

-- ============ DELIVERY: open a free listing in Petal ============
CREATE OR REPLACE FUNCTION public.marketplace_open_listing(p_slug text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_listing public.marketplace_listings%ROWTYPE;
  v_project_id uuid;
  v_file jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT * INTO v_listing
  FROM public.marketplace_listings
  WHERE slug = p_slug AND status = 'live';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not available';
  END IF;

  IF v_listing.price_minor > 0 THEN
    RAISE EXCEPTION 'This product requires a purchase';
  END IF;

  INSERT INTO public.projects (owner_id, title, summary)
  VALUES (v_user, v_listing.title, NULLIF(v_listing.pitch, ''))
  RETURNING id INTO v_project_id;

  FOR v_file IN SELECT * FROM jsonb_array_elements(v_listing.source_files)
  LOOP
    INSERT INTO public.project_files (project_id, path, content)
    VALUES (v_project_id, v_file->>'path', COALESCE(v_file->>'content', ''))
    ON CONFLICT DO NOTHING;
  END LOOP;

  UPDATE public.marketplace_listings
  SET open_count = open_count + 1
  WHERE id = v_listing.id;

  RETURN v_project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.marketplace_open_listing(text) TO authenticated;