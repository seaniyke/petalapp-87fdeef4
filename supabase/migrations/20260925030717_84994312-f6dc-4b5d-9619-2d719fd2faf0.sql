CREATE OR REPLACE FUNCTION public.marketplace_is_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value = 'true'::jsonb FROM public.system_settings WHERE key = 'features.marketplace'),
    false
  )
$$;
GRANT EXECUTE ON FUNCTION public.marketplace_is_enabled() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "creators insert own listings" ON public.marketplace_listings;
CREATE POLICY "creators insert own listings"
  ON public.marketplace_listings FOR INSERT
  TO authenticated
  WITH CHECK (
    public.marketplace_is_enabled()
    AND creator_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "creators update own listings" ON public.marketplace_listings;
CREATE POLICY "creators update own listings"
  ON public.marketplace_listings FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (public.marketplace_is_enabled() AND creator_id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (public.marketplace_is_enabled() AND creator_id = auth.uid())
  );

DROP POLICY IF EXISTS "creators delete own listings" ON public.marketplace_listings;
CREATE POLICY "creators delete own listings"
  ON public.marketplace_listings FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (public.marketplace_is_enabled() AND creator_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.marketplace_list_live()
RETURNS TABLE (
  id uuid, slug text, title text, pitch text, category text,
  cover_url text, screenshots text[], demo_url text,
  price_minor bigint, currency_code text, license_code text,
  open_count int, file_count int, published_at timestamptz, creator_id uuid,
  rating_avg numeric, rating_count int, sales_count int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.id, l.slug, l.title, l.pitch, l.category,
         l.cover_url, l.screenshots, l.demo_url,
         l.price_minor, l.currency_code, l.license_code,
         l.open_count, l.file_count, l.published_at, l.creator_id,
         l.rating_avg, l.rating_count, l.sales_count
  FROM public.marketplace_listings l
  WHERE public.marketplace_is_enabled() AND l.status = 'live'
  ORDER BY l.published_at DESC NULLS LAST
  LIMIT 200
$$;

CREATE OR REPLACE FUNCTION public.marketplace_get_live(p_slug text)
RETURNS TABLE (
  id uuid, slug text, title text, pitch text, description text, category text,
  cover_url text, screenshots text[], demo_url text,
  price_minor bigint, currency_code text, license_code text,
  open_count int, file_count int, published_at timestamptz, creator_id uuid,
  rating_avg numeric, rating_count int, sales_count int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.id, l.slug, l.title, l.pitch, l.description, l.category,
         l.cover_url, l.screenshots, l.demo_url,
         l.price_minor, l.currency_code, l.license_code,
         l.open_count, l.file_count, l.published_at, l.creator_id,
         l.rating_avg, l.rating_count, l.sales_count
  FROM public.marketplace_listings l
  WHERE public.marketplace_is_enabled() AND l.status = 'live' AND l.slug = p_slug
$$;

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
  v_owned boolean;
BEGIN
  IF NOT public.marketplace_is_enabled() THEN
    RAISE EXCEPTION 'Marketplace is currently unavailable';
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT * INTO v_listing
  FROM public.marketplace_listings
  WHERE slug = p_slug AND status = 'live';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not available';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_purchases
    WHERE listing_id = v_listing.id AND buyer_id = v_user
  ) INTO v_owned;

  IF v_listing.price_minor > 0 AND NOT v_owned AND v_listing.creator_id <> v_user THEN
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

CREATE OR REPLACE FUNCTION public.marketplace_submit_review(
  p_slug text, p_rating int, p_body text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_listing public.marketplace_listings%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT public.marketplace_is_enabled() THEN RAISE EXCEPTION 'Marketplace is currently unavailable'; END IF;
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_rating < 1 OR p_rating > 5 THEN RAISE EXCEPTION 'Rating must be 1-5'; END IF;

  SELECT * INTO v_listing FROM public.marketplace_listings
  WHERE slug = p_slug AND status = 'live';
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing not available'; END IF;

  IF v_listing.creator_id = v_user THEN
    RAISE EXCEPTION 'You cannot review your own product';
  END IF;

  IF v_listing.price_minor > 0 AND NOT EXISTS (
    SELECT 1 FROM public.marketplace_purchases
    WHERE listing_id = v_listing.id AND buyer_id = v_user
  ) THEN
    RAISE EXCEPTION 'Only buyers can review this product';
  END IF;

  INSERT INTO public.marketplace_reviews (listing_id, listing_slug, reviewer_id, rating, body)
  VALUES (v_listing.id, v_listing.slug, v_user, p_rating, COALESCE(left(btrim(p_body), 1000), ''))
  ON CONFLICT (listing_id, reviewer_id) DO UPDATE
    SET rating = EXCLUDED.rating, body = EXCLUDED.body, updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_list_reviews(p_slug text)
RETURNS TABLE (
  id uuid, rating int, body text, created_at timestamptz,
  reviewer_name text, reviewer_avatar text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.id, r.rating, r.body, r.created_at,
         COALESCE(NULLIF(pr.display_name, ''), 'Kimble builder'),
         pr.avatar_url
  FROM public.marketplace_reviews r
  JOIN public.marketplace_listings l ON l.id = r.listing_id AND l.status = 'live'
  LEFT JOIN public.profiles pr ON pr.id = r.reviewer_id
  WHERE public.marketplace_is_enabled() AND l.slug = p_slug
  ORDER BY r.created_at DESC
  LIMIT 100
$$;