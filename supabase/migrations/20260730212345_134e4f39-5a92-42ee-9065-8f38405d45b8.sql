-- Price overrides: signed-in users only (checkout needs them)
DROP POLICY IF EXISTS "Price overrides are viewable by everyone" ON public.billing_price_overrides;
CREATE POLICY "Price overrides viewable by authenticated users"
  ON public.billing_price_overrides FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.billing_price_overrides FROM anon;

-- System settings: admins only
DROP POLICY IF EXISTS "Settings are viewable by everyone" ON public.system_settings;
CREATE POLICY "Admins can view settings"
  ON public.system_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE SELECT ON public.system_settings FROM anon;