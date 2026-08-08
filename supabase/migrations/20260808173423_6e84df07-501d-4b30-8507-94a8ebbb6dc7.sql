UPDATE public.project_builds
SET status = 'ready',
    dist_path = 'https://366f3a2b.petal-71aa7384bb51.pages.dev',
    error_message = NULL,
    ready_at = now()
WHERE id = '72bfabca-7873-4357-a9b7-cae1ff1937c8'
  AND project_id = '71aa7384-bb51-4c76-b29a-7fd5e231ad6c'
  AND status = 'failed';

UPDATE public.projects
SET latest_build_id = '72bfabca-7873-4357-a9b7-cae1ff1937c8'
WHERE id = '71aa7384-bb51-4c76-b29a-7fd5e231ad6c'
  AND EXISTS (
    SELECT 1
    FROM public.project_builds b
    WHERE b.id = '72bfabca-7873-4357-a9b7-cae1ff1937c8'
      AND b.project_id = public.projects.id
      AND b.status = 'ready'
  );