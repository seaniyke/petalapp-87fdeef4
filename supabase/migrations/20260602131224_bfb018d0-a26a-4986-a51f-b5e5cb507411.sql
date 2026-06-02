ALTER TABLE public.mobile_signing_profiles
  ADD COLUMN IF NOT EXISTS apple_p12_not_after timestamptz,
  ADD COLUMN IF NOT EXISTS apple_provisioning_profile_not_after timestamptz;

CREATE INDEX IF NOT EXISTS idx_mobile_signing_profiles_apple_expiry
  ON public.mobile_signing_profiles (apple_provisioning_profile_not_after)
  WHERE apple_provisioning_profile_not_after IS NOT NULL;