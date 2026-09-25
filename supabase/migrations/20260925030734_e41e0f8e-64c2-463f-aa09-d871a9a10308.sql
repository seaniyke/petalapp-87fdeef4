GRANT SELECT ON public.system_settings TO anon;

DROP POLICY IF EXISTS "Public can read marketplace feature status" ON public.system_settings;
CREATE POLICY "Public can read marketplace feature status"
  ON public.system_settings FOR SELECT
  TO anon
  USING (key = 'features.marketplace');

CREATE OR REPLACE FUNCTION public.marketplace_is_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value = 'true'::jsonb FROM public.system_settings WHERE key = 'features.marketplace'),
    false
  )
$$;