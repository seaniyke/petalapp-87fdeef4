-- ============ CONFIG ============
CREATE TABLE public.marketplace_config (
  id boolean PRIMARY KEY DEFAULT true,
  commission_bps int NOT NULL DEFAULT 2000,
  min_payout_cents bigint NOT NULL DEFAULT 5000,
  payouts_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_config_singleton CHECK (id),
  CONSTRAINT marketplace_config_bps CHECK (commission_bps BETWEEN 0 AND 5000)
);

GRANT SELECT ON public.marketplace_config TO anon, authenticated;
GRANT ALL ON public.marketplace_config TO service_role;
ALTER TABLE public.marketplace_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "config readable by everyone"
  ON public.marketplace_config FOR SELECT USING (true);
CREATE POLICY "admins manage config"
  ON public.marketplace_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.marketplace_config (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ============ EARNINGS (append-only) ============
CREATE TABLE public.marketplace_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL UNIQUE REFERENCES public.marketplace_purchases(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.marketplace_listings(id) ON DELETE SET NULL,
  listing_slug text NOT NULL DEFAULT '',
  gross_cents bigint NOT NULL DEFAULT 0,
  commission_cents bigint NOT NULL DEFAULT 0,
  net_cents bigint NOT NULL DEFAULT 0,
  payout_state text NOT NULL DEFAULT 'available',
  payout_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_earnings_state_check
    CHECK (payout_state IN ('available','requested','paid','reversed'))
);

CREATE INDEX marketplace_earnings_creator_idx
  ON public.marketplace_earnings (creator_id, created_at DESC);

GRANT SELECT ON public.marketplace_earnings TO authenticated;
GRANT ALL ON public.marketplace_earnings TO service_role;
ALTER TABLE public.marketplace_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "creator reads own earnings"
  ON public.marketplace_earnings FOR SELECT TO authenticated
  USING (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Every purchase writes exactly one earnings row, priced off live config.
CREATE OR REPLACE FUNCTION public.marketplace_record_earning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bps int;
  v_fee bigint;
BEGIN
  SELECT commission_bps INTO v_bps FROM public.marketplace_config WHERE id;
  v_bps := COALESCE(v_bps, 2000);
  v_fee := GREATEST(0, (NEW.usd_amount_cents * v_bps) / 10000);

  INSERT INTO public.marketplace_earnings (
    creator_id, purchase_id, listing_id, listing_slug,
    gross_cents, commission_cents, net_cents
  ) VALUES (
    NEW.creator_id, NEW.id, NEW.listing_id, NEW.listing_slug,
    NEW.usd_amount_cents, v_fee, NEW.usd_amount_cents - v_fee
  )
  ON CONFLICT (purchase_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER marketplace_purchases_earn
  AFTER INSERT ON public.marketplace_purchases
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_record_earning();

-- Backfill earnings for purchases already recorded.
INSERT INTO public.marketplace_earnings (
  creator_id, purchase_id, listing_id, listing_slug,
  gross_cents, commission_cents, net_cents
)
SELECT p.creator_id, p.id, p.listing_id, p.listing_slug,
       p.usd_amount_cents, p.platform_fee_cents, p.creator_net_cents
FROM public.marketplace_purchases p
ON CONFLICT (purchase_id) DO NOTHING;

-- ============ PAYOUTS ============
CREATE TABLE public.marketplace_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL,
  method text NOT NULL DEFAULT 'bank',
  destination text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  admin_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_payouts_amount_check CHECK (amount_cents > 0),
  CONSTRAINT marketplace_payouts_status_check
    CHECK (status IN ('pending','approved','paid','rejected','cancelled')),
  CONSTRAINT marketplace_payouts_method_check
    CHECK (method IN ('bank','paystack','crypto'))
);

CREATE INDEX marketplace_payouts_creator_idx
  ON public.marketplace_payouts (creator_id, requested_at DESC);

GRANT SELECT ON public.marketplace_payouts TO authenticated;
GRANT ALL ON public.marketplace_payouts TO service_role;
ALTER TABLE public.marketplace_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "creator reads own payouts"
  ON public.marketplace_payouts FOR SELECT TO authenticated
  USING (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER marketplace_payouts_touch
  BEFORE UPDATE ON public.marketplace_payouts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.marketplace_earnings
  ADD CONSTRAINT marketplace_earnings_payout_fk
  FOREIGN KEY (payout_id) REFERENCES public.marketplace_payouts(id) ON DELETE SET NULL;

-- ============ REVIEWS ============
CREATE TABLE public.marketplace_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  listing_slug text NOT NULL,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating int NOT NULL,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT marketplace_reviews_unique UNIQUE (listing_id, reviewer_id)
);

CREATE INDEX marketplace_reviews_listing_idx
  ON public.marketplace_reviews (listing_id, created_at DESC);

GRANT SELECT ON public.marketplace_reviews TO anon, authenticated;
GRANT ALL ON public.marketplace_reviews TO service_role;
ALTER TABLE public.marketplace_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews readable by everyone"
  ON public.marketplace_reviews FOR SELECT USING (true);

CREATE POLICY "admins manage reviews"
  ON public.marketplace_reviews FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.marketplace_listings
  ADD COLUMN rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN rating_count int NOT NULL DEFAULT 0,
  ADD COLUMN sales_count int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.marketplace_refresh_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing uuid := COALESCE(NEW.listing_id, OLD.listing_id);
BEGIN
  UPDATE public.marketplace_listings l
  SET rating_avg = COALESCE(s.avg_rating, 0),
      rating_count = COALESCE(s.n, 0)
  FROM (
    SELECT AVG(rating)::numeric(3,2) AS avg_rating, COUNT(*) AS n
    FROM public.marketplace_reviews WHERE listing_id = v_listing
  ) s
  WHERE l.id = v_listing;
  RETURN NULL;
END;
$$;

CREATE TRIGGER marketplace_reviews_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.marketplace_reviews
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_refresh_rating();

CREATE TRIGGER marketplace_reviews_touch
  BEFORE UPDATE ON public.marketplace_reviews
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.marketplace_bump_sales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.marketplace_listings
  SET sales_count = sales_count + 1
  WHERE id = NEW.listing_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER marketplace_purchases_sales
  AFTER INSERT ON public.marketplace_purchases
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_bump_sales();

UPDATE public.marketplace_listings l
SET sales_count = COALESCE(s.n, 0)
FROM (SELECT listing_id, COUNT(*) n FROM public.marketplace_purchases GROUP BY listing_id) s
WHERE l.id = s.listing_id;

-- ============ DISCOVERY: expose social proof ============
DROP FUNCTION IF EXISTS public.marketplace_list_live();
CREATE FUNCTION public.marketplace_list_live()
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
  WHERE l.status = 'live'
  ORDER BY l.published_at DESC NULLS LAST
  LIMIT 200
$$;
GRANT EXECUTE ON FUNCTION public.marketplace_list_live() TO anon, authenticated;

DROP FUNCTION IF EXISTS public.marketplace_get_live(text);
CREATE FUNCTION public.marketplace_get_live(p_slug text)
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
  WHERE l.status = 'live' AND l.slug = p_slug
$$;
GRANT EXECUTE ON FUNCTION public.marketplace_get_live(text) TO anon, authenticated;

-- ============ CREATOR SUMMARY ============
CREATE OR REPLACE FUNCTION public.marketplace_creator_summary()
RETURNS TABLE (
  sales_count bigint, gross_cents bigint, commission_cents bigint,
  net_cents bigint, available_cents bigint, requested_cents bigint,
  paid_cents bigint, min_payout_cents bigint, payouts_enabled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COUNT(*)::bigint,
    COALESCE(SUM(e.gross_cents), 0)::bigint,
    COALESCE(SUM(e.commission_cents), 0)::bigint,
    COALESCE(SUM(e.net_cents), 0)::bigint,
    COALESCE(SUM(e.net_cents) FILTER (WHERE e.payout_state = 'available'), 0)::bigint,
    COALESCE(SUM(e.net_cents) FILTER (WHERE e.payout_state = 'requested'), 0)::bigint,
    COALESCE(SUM(e.net_cents) FILTER (WHERE e.payout_state = 'paid'), 0)::bigint,
    (SELECT min_payout_cents FROM public.marketplace_config WHERE id),
    (SELECT payouts_enabled FROM public.marketplace_config WHERE id)
  FROM public.marketplace_earnings e
  WHERE e.creator_id = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION public.marketplace_creator_summary() TO authenticated;

-- ============ PAYOUT REQUEST ============
CREATE OR REPLACE FUNCTION public.marketplace_request_payout(
  p_method text, p_destination text
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_available bigint;
  v_min bigint;
  v_enabled boolean;
  v_payout uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_method NOT IN ('bank','paystack','crypto') THEN
    RAISE EXCEPTION 'Unsupported payout method';
  END IF;
  IF COALESCE(btrim(p_destination), '') = '' THEN
    RAISE EXCEPTION 'Payout destination required';
  END IF;

  SELECT min_payout_cents, payouts_enabled INTO v_min, v_enabled
  FROM public.marketplace_config WHERE id;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'Payouts are not open yet';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.marketplace_payouts
    WHERE creator_id = v_user AND status IN ('pending','approved')
  ) THEN
    RAISE EXCEPTION 'You already have a payout in progress';
  END IF;

  SELECT COALESCE(SUM(net_cents), 0) INTO v_available
  FROM public.marketplace_earnings
  WHERE creator_id = v_user AND payout_state = 'available';

  IF v_available < COALESCE(v_min, 5000) THEN
    RAISE EXCEPTION 'Minimum payout is % cents', COALESCE(v_min, 5000);
  END IF;

  INSERT INTO public.marketplace_payouts (creator_id, amount_cents, method, destination)
  VALUES (v_user, v_available, p_method, btrim(p_destination))
  RETURNING id INTO v_payout;

  UPDATE public.marketplace_earnings
  SET payout_state = 'requested', payout_id = v_payout
  WHERE creator_id = v_user AND payout_state = 'available';

  RETURN v_payout;
END;
$$;
GRANT EXECUTE ON FUNCTION public.marketplace_request_payout(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_cancel_payout(p_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  UPDATE public.marketplace_payouts
  SET status = 'cancelled', decided_at = now()
  WHERE id = p_id AND creator_id = v_user AND status = 'pending';

  IF NOT FOUND THEN RAISE EXCEPTION 'Payout cannot be cancelled'; END IF;

  UPDATE public.marketplace_earnings
  SET payout_state = 'available', payout_id = NULL
  WHERE payout_id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.marketplace_cancel_payout(uuid) TO authenticated;

-- ============ ADMIN PAYOUTS ============
CREATE OR REPLACE FUNCTION public.marketplace_admin_list_payouts(p_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid, creator_id uuid, creator_email text, amount_cents bigint,
  method text, destination text, status text, admin_note text,
  requested_at timestamptz, decided_at timestamptz, paid_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY
  SELECT p.id, p.creator_id, u.email::text, p.amount_cents, p.method,
         p.destination, p.status, p.admin_note,
         p.requested_at, p.decided_at, p.paid_at
  FROM public.marketplace_payouts p
  LEFT JOIN auth.users u ON u.id = p.creator_id
  WHERE p_status IS NULL OR p.status = p_status
  ORDER BY p.requested_at DESC
  LIMIT 200;
END;
$$;
GRANT EXECUTE ON FUNCTION public.marketplace_admin_list_payouts(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_admin_decide_payout(
  p_id uuid, p_decision text, p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_decision NOT IN ('approved','paid','rejected') THEN
    RAISE EXCEPTION 'Unknown decision';
  END IF;

  UPDATE public.marketplace_payouts
  SET status = p_decision,
      admin_note = COALESCE(p_note, admin_note),
      decided_at = now(),
      paid_at = CASE WHEN p_decision = 'paid' THEN now() ELSE paid_at END
  WHERE id = p_id AND status IN ('pending','approved');

  IF NOT FOUND THEN RAISE EXCEPTION 'Payout is not open'; END IF;

  IF p_decision = 'paid' THEN
    UPDATE public.marketplace_earnings
    SET payout_state = 'paid' WHERE payout_id = p_id;
  ELSIF p_decision = 'rejected' THEN
    UPDATE public.marketplace_earnings
    SET payout_state = 'available', payout_id = NULL WHERE payout_id = p_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.marketplace_admin_decide_payout(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_admin_set_config(
  p_commission_bps int, p_min_payout_cents bigint, p_payouts_enabled boolean
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  UPDATE public.marketplace_config
  SET commission_bps = p_commission_bps,
      min_payout_cents = p_min_payout_cents,
      payouts_enabled = p_payouts_enabled,
      updated_at = now()
  WHERE id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.marketplace_admin_set_config(int, bigint, boolean) TO authenticated;

-- ============ REVIEWS API ============
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
GRANT EXECUTE ON FUNCTION public.marketplace_submit_review(text, int, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_list_reviews(p_slug text)
RETURNS TABLE (
  id uuid, rating int, body text, created_at timestamptz,
  reviewer_name text, reviewer_avatar text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.id, r.rating, r.body, r.created_at,
         COALESCE(NULLIF(pr.display_name, ''), 'Petal builder'),
         pr.avatar_url
  FROM public.marketplace_reviews r
  JOIN public.marketplace_listings l ON l.id = r.listing_id AND l.status = 'live'
  LEFT JOIN public.profiles pr ON pr.id = r.reviewer_id
  WHERE l.slug = p_slug
  ORDER BY r.created_at DESC
  LIMIT 100
$$;
GRANT EXECUTE ON FUNCTION public.marketplace_list_reviews(text) TO anon, authenticated;