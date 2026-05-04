-- 1. mobile_apps: make user-input fields optional, add petal-managed fields
ALTER TABLE public.mobile_apps
  ALTER COLUMN bundle_id DROP NOT NULL,
  ALTER COLUMN codemagic_app_id DROP NOT NULL;

ALTER TABLE public.mobile_apps
  ADD COLUMN IF NOT EXISTS github_repo text,
  ADD COLUMN IF NOT EXISTS github_default_branch text NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS signing_profile_id uuid;

-- 2. mobile_signing_profiles: encrypted store-signing materials, per project
CREATE TABLE IF NOT EXISTS public.mobile_signing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE,
  -- Apple side (App Store / sideload signed)
  apple_team_id text,
  apple_bundle_id text,
  apple_p12_ciphertext text,         -- AES-GCM encrypted .p12 (base64)
  apple_p12_password_ciphertext text,
  apple_provisioning_profile_ciphertext text,
  apple_app_store_connect_key_id text,
  apple_app_store_connect_issuer_id text,
  apple_app_store_connect_key_ciphertext text,
  -- Android side (Play Store)
  android_keystore_ciphertext text,
  android_keystore_password_ciphertext text,
  android_key_alias text,
  android_key_password_ciphertext text,
  android_play_service_account_ciphertext text,
  -- Bookkeeping
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mobile_signing_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their signing profile"
  ON public.mobile_signing_profiles
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = mobile_signing_profiles.project_id
      AND (p.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  ));

CREATE POLICY "Owners insert their signing profile"
  ON public.mobile_signing_profiles
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = mobile_signing_profiles.project_id
      AND p.owner_id = auth.uid()
  ));

CREATE POLICY "Owners update their signing profile"
  ON public.mobile_signing_profiles
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = mobile_signing_profiles.project_id
      AND p.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = mobile_signing_profiles.project_id
      AND p.owner_id = auth.uid()
  ));

CREATE POLICY "Owners delete their signing profile"
  ON public.mobile_signing_profiles
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = mobile_signing_profiles.project_id
      AND p.owner_id = auth.uid()
  ));

CREATE TRIGGER update_mobile_signing_profiles_updated_at
  BEFORE UPDATE ON public.mobile_signing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. mobile_builds: track which signing profile shipped this build
ALTER TABLE public.mobile_builds
  ADD COLUMN IF NOT EXISTS signing_profile_id uuid;