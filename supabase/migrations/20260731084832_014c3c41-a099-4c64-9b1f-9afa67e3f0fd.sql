DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.project_files
    WHERE project_id = '51d0ef30-d894-4339-b7e8-64ff827c3c8d'::uuid
      AND path = 'src/main.tsx'
      AND content LIKE '%<RouterProvider router={router} />%'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.project_files
    WHERE project_id = '51d0ef30-d894-4339-b7e8-64ff827c3c8d'::uuid
      AND path = 'src/router.tsx'
      AND content LIKE '%createRouter({ routeTree })%'
  ) THEN
    RAISE EXCEPTION 'router repair verification failed';
  END IF;
END $$;