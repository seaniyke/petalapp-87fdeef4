CREATE OR REPLACE FUNCTION public.apply_paystack_marketplace_purchase(_user_id uuid, _reference text, _listing_slug text, _amount_minor bigint, _currency_code text, _usd_amount_cents bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_listing public.marketplace_listings%ROWTYPE;
  v_bps int;
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

  SELECT commission_bps INTO v_bps FROM public.marketplace_config WHERE id;
  v_bps := COALESCE(v_bps, 2000);
  v_fee := GREATEST(0, (_usd_amount_cents * v_bps) / 10000);

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
$function$;