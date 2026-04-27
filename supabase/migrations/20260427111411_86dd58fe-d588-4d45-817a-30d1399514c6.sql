ALTER TABLE public.project_integration_secrets
  ALTER COLUMN ciphertext TYPE text USING encode(ciphertext, 'hex');