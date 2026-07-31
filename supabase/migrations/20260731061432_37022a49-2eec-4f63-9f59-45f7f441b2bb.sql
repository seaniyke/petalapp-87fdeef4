DROP POLICY IF EXISTS "Price overrides viewable by authenticated users" ON public.billing_price_overrides;

CREATE POLICY "Admins can view price overrides"
ON public.billing_price_overrides
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE SELECT ON public.billing_price_overrides FROM anon;