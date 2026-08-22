-- ============ PURCHASES ============
CREATE TABLE public.marketplace_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_slug text NOT NULL,
  listing_title text NOT NULL,
  license_code text NOT NULL,
  price_minor bigint NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'USD',
  usd_amount_cents bigint NOT NULL DEFAULT 0,
  platform_fee_cents bigint NOT NULL DEFAULT 0,
  creator_net_cents bigint NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'paystack',
  reference text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_purchases_source_check
    CHECK (source IN ('paystack','crypto','free','grant')),
  CONSTRAINT marketplace_purchases_unique_buyer UNIQUE (listing_id, buyer_id)
);

CREATE INDEX marketplace_purchases_buyer_idx ON public.marketplace_purchases (buyer_id, created_at DESC);
CREATE INDEX marketplace_purchases_creator_idx ON public.marketplace_purchases (creator_id, created_at DESC);

GRANT SELECT ON public.marketplace_purchases TO authenticated;
GRANT ALL ON public.marketplace_purchases TO service_role;

ALTER TABLE public.marketplace_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "buyer or creator reads purchase"
  ON public.marketplace_purchases FOR SELECT
  TO authenticated
  USING (
    buyer_id = auth.uid()
    OR creator_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- ============ CREATORS CANNOT SELF-PUBLISH ============
CREATE OR REPLACE FUNCTION public.guard_marketplace_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft','in_review') THEN
      RAISE EXCEPTION 'Listings start as a draft and go live after review';
    END IF;
    NEW.published_at := NULL;
    NEW.review_note := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Creators may only move between draft / in_review, or delist their own live product.
    IF NOT (
      (OLD.status IN ('draft','rejected') AND NEW.status IN ('draft','in_review'))
      OR (OLD.status IN ('live','in_review') AND NEW.status IN ('delisted','draft'))
    ) THEN
      RAISE EXCEPTION 'Only a Petal review can change a listing to %', NEW.status;
    END IF;
  END IF;

  NEW.published_at := OLD.published_at;
  NEW.review_note := OLD.review_note;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_listings_status_guard
  BEFORE INSERT OR UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.guard_marketplace_status();

-- ============ PAYSTACK APPLY ============
CREATE OR REPLACE FUNCTION public.apply_paystack_marketplace_purchase(
  _user_id uuid,
  _reference text,
  _listing_slug text,
  _amount_minor bigint,
  _currency_code text,
  _usd_amount_cents bigint
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing public.marketplace_listings%ROWTYPE;
  v_fee bigint;
  v_existing uuid;
  v_id uuid;
BEGIN
  SELECT id INTO v_existing FROM public.marketplace_purchases WHERE reference = _reference;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_listing FROM public.marketplace_listings WHERE slug = _listing_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing % not found', _listing_slug;
  END IF;

  v_fee := GREATEST(0, (_usd_amount_cents * 20) / 100);

  INSERT INTO public.marketplace_purchases (
    listing_id, buyer_id, creator_id, listing_slug, listing_title, license_code,
    price_minor, currency_code, usd_amount_cents, platform_fee_cents, creator_net_cents,
    source, reference
  ) VALUES (
    v_listing.id, _user_id, v_listing.creator_id, v_listing.slug, v_listing.title,
    v_listing.license_code, _amount_minor, _currency_code, _usd_amount_cents,
    v_fee, _usd_amount_cents - v_fee, 'paystack', _reference
  )
  ON CONFLICT (listing_id, buyer_id) DO UPDATE
    SET reference = COALESCE(public.marketplace_purchases.reference, EXCLUDED.reference)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_paystack_marketplace_purchase(uuid, text, text, bigint, text, bigint) FROM anon, authenticated;

-- ============ DELIVERY (free OR purchased) ============
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

GRANT EXECUTE ON FUNCTION public.marketplace_open_listing(text) TO authenticated;

-- Has the signed-in user already bought this product?
CREATE OR REPLACE FUNCTION public.marketplace_owns_listing(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.marketplace_purchases p
    JOIN public.marketplace_listings l ON l.id = p.listing_id
    WHERE l.slug = p_slug AND p.buyer_id = auth.uid()
  )
$$;

GRANT EXECUTE ON FUNCTION public.marketplace_owns_listing(text) TO authenticated;