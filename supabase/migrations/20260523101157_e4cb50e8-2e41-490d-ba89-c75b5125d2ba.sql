-- 1. Hide service_role_key from clients; server uses service-role bypass
REVOKE SELECT (service_role_key) ON public.project_backends FROM anon, authenticated;

-- 2. Remove public read access on project_versions (files contain source code)
DROP POLICY IF EXISTS "Anyone can view versions of public projects" ON public.project_versions;

-- 3. Hide custom_instructions from anonymous viewers of public projects
REVOKE SELECT (custom_instructions) ON public.projects FROM anon;

-- 4. Lock down project-builds storage bucket: only service_role can write
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'project-builds service-role only insert' AND polrelid = 'storage.objects'::regclass) THEN
    CREATE POLICY "project-builds service-role only insert"
      ON storage.objects FOR INSERT TO authenticated, anon
      WITH CHECK (bucket_id <> 'project-builds');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'project-builds service-role only update' AND polrelid = 'storage.objects'::regclass) THEN
    CREATE POLICY "project-builds service-role only update"
      ON storage.objects FOR UPDATE TO authenticated, anon
      USING (bucket_id <> 'project-builds');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'project-builds service-role only delete' AND polrelid = 'storage.objects'::regclass) THEN
    CREATE POLICY "project-builds service-role only delete"
      ON storage.objects FOR DELETE TO authenticated, anon
      USING (bucket_id <> 'project-builds');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'project-builds no client select' AND polrelid = 'storage.objects'::regclass) THEN
    CREATE POLICY "project-builds no client select"
      ON storage.objects FOR SELECT TO authenticated, anon
      USING (bucket_id <> 'project-builds');
  END IF;
END $$;

-- 5. Default-deny on realtime.messages so users cannot subscribe to others' topics.
-- Server-side broadcasts using the service role bypass RLS and continue to work.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages') THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Authenticated users can only read own topic' AND polrelid = 'realtime.messages'::regclass) THEN
      EXECUTE $p$
        CREATE POLICY "Authenticated users can only read own topic"
          ON realtime.messages FOR SELECT TO authenticated
          USING (
            (extension = 'broadcast' OR extension = 'presence')
            AND (
              topic LIKE ('user:' || auth.uid()::text || ':%')
              OR topic = ('user:' || auth.uid()::text)
            )
          )
      $p$;
    END IF;
  END IF;
END $$;