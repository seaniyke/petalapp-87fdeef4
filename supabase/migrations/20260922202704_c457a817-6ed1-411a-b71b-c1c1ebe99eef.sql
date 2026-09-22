CREATE POLICY "admins upload library images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'petal-images'
  AND (storage.foldername(name))[1] = 'library'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "admins update library images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'petal-images'
  AND (storage.foldername(name))[1] = 'library'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "admins delete library images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'petal-images'
  AND (storage.foldername(name))[1] = 'library'
  AND public.has_role(auth.uid(), 'admin')
);