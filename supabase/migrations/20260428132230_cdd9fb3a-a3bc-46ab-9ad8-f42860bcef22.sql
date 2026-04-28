-- Per-feature AI provider override, editable from /admin/ai-providers.
-- Empty/missing row = fall back to env var AI_PROVIDER_<FEATURE> or AI_PROVIDER, then "lovable".

CREATE TABLE IF NOT EXISTS public.ai_provider_settings (
  feature      TEXT PRIMARY KEY,
  provider     TEXT NOT NULL CHECK (provider IN ('lovable', 'openrouter')),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID
);

ALTER TABLE public.ai_provider_settings ENABLE ROW LEVEL SECURITY;

-- Admin-only read/write. Server code uses service-role and bypasses RLS.
CREATE POLICY "Admins can read ai_provider_settings"
  ON public.ai_provider_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert ai_provider_settings"
  ON public.ai_provider_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update ai_provider_settings"
  ON public.ai_provider_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete ai_provider_settings"
  ON public.ai_provider_settings
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));