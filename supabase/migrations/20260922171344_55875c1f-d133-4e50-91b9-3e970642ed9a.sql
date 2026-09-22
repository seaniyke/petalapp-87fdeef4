-- 1. Billing / pricing catalogues: public may read ACTIVE entries only.
--    Admins keep full read access for the admin console.
DROP POLICY IF EXISTS "Plans are viewable by everyone" ON public.billing_plans;
CREATE POLICY "Active plans are viewable by everyone"
  ON public.billing_plans FOR SELECT TO anon, authenticated
  USING (is_active = true);
CREATE POLICY "Admins can view all plans"
  ON public.billing_plans FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Credit packs are viewable by everyone" ON public.credit_packs;
CREATE POLICY "Active credit packs are viewable by everyone"
  ON public.credit_packs FOR SELECT TO anon, authenticated
  USING (is_active = true);
CREATE POLICY "Admins can view all credit packs"
  ON public.credit_packs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Add-ons are viewable by everyone" ON public.billing_addons;
CREATE POLICY "Active add-ons are viewable by everyone"
  ON public.billing_addons FOR SELECT TO anon, authenticated
  USING (is_active = true);
CREATE POLICY "Admins can view all add-ons"
  ON public.billing_addons FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Currencies are viewable by everyone" ON public.billing_currencies;
CREATE POLICY "Active currencies are viewable by everyone"
  ON public.billing_currencies FOR SELECT TO anon, authenticated
  USING (is_active = true);
CREATE POLICY "Admins can view all currencies"
  ON public.billing_currencies FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anyone can view active runtime packs" ON public.runtime_topup_packs;
CREATE POLICY "Active runtime packs are viewable by everyone"
  ON public.runtime_topup_packs FOR SELECT TO anon, authenticated
  USING (is_active = true);
CREATE POLICY "Admins can view all runtime packs"
  ON public.runtime_topup_packs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Marketplace licence catalogue: gains an explicit publish flag so the
--    public read is scoped to licences that are meant to be shown.
ALTER TABLE public.marketplace_licenses
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "licenses readable by everyone" ON public.marketplace_licenses;
CREATE POLICY "Published licenses are readable"
  ON public.marketplace_licenses FOR SELECT TO anon, authenticated
  USING (is_public = true);
CREATE POLICY "Admins can view all licenses"
  ON public.marketplace_licenses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. Marketplace settings (commission, payout minimums): admin-only.
--    Public listing pages never read this table directly.
DROP POLICY IF EXISTS "config readable by everyone" ON public.marketplace_config;
CREATE POLICY "Admins can read marketplace config"
  ON public.marketplace_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4. Reviews: public listing pages read them through the security-definer
--    function marketplace_list_reviews, so the table itself only needs to be
--    readable by the review's author and admins.
DROP POLICY IF EXISTS "reviews readable by everyone" ON public.marketplace_reviews;
CREATE POLICY "Reviewers can read their own reviews"
  ON public.marketplace_reviews FOR SELECT TO authenticated
  USING (auth.uid() = reviewer_id);
CREATE POLICY "Admins can read all reviews"
  ON public.marketplace_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5. Saved project previews: only ever read server-side; scope to the
--    project owner and admins.
DROP POLICY IF EXISTS "Saved previews are readable by anyone" ON public.project_thumbnails;
CREATE POLICY "Owners can read their saved previews"
  ON public.project_thumbnails FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_thumbnails.project_id
        AND p.owner_id = auth.uid()
    )
  );
CREATE POLICY "Admins can read saved previews"
  ON public.project_thumbnails FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 6. File storage: replace the blanket "every bucket except project-builds"
--    read rule with an owner-bound one. Public assets in petal-images are
--    still served through their public bucket URLs.
DROP POLICY IF EXISTS "project-builds no client select" ON storage.objects;
DROP POLICY IF EXISTS "Public read petal-images" ON storage.objects;
CREATE POLICY "Users can read their own files"
  ON storage.objects FOR SELECT TO authenticated
  USING (owner_id = (select auth.uid()::text));