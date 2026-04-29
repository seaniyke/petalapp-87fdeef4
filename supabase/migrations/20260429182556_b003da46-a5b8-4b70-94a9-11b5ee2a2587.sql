ALTER TABLE public.project_domains
ADD COLUMN IF NOT EXISTS verification_records JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.project_domains.verification_records IS
  'Array of {name, value} TXT records the user must add for SSL validation. Cloudflare often issues 2 (RSA + ECDSA cert variants) under the same _acme-challenge name. Supersedes the single verification_txt_name/value columns, which are kept for backward compatibility and mirror the first record.';