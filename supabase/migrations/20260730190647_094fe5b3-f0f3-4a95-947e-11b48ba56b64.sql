ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS economy_mode boolean DEFAULT false;

ALTER TABLE public.ai_provider_settings
  ADD COLUMN IF NOT EXISTS budget_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS shadow_pct smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_models text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_profiles_economy_mode ON public.profiles (economy_mode);