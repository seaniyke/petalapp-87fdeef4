DROP POLICY IF EXISTS "Authenticated users can only read own topic" ON public.messages;
DROP POLICY IF EXISTS "Anyone can view files of public projects" ON public.project_files;