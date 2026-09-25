INSERT INTO public.system_settings (key, value, description)
VALUES (
  'features.marketplace',
  'false'::jsonb,
  'Controls whether Kimble Marketplace is available on customer-facing surfaces.'
)
ON CONFLICT (key) DO NOTHING;