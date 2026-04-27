
-- Public bucket for AI-generated images embedded in user projects.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'petal-images',
  'petal-images',
  true,
  10485760, -- 10 MB cap per image
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read; writes restricted to service role (no INSERT policy for anon/authenticated).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read petal-images'
  ) THEN
    CREATE POLICY "Public read petal-images"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'petal-images');
  END IF;
END $$;
