-- 1. Unique constraint so upserts work on (project_id, path)
ALTER TABLE public.project_files
  ADD CONSTRAINT project_files_project_path_unique UNIQUE (project_id, path);

-- 2. Atomic replace function: delete missing paths + upsert provided files in a single transaction
CREATE OR REPLACE FUNCTION public.replace_project_files(
  _project_id uuid,
  _files jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Authorization: only owner (or admin) may modify. RLS still applies to writes,
  -- but an explicit guard gives a clearer error.
  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id
      AND (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  ) THEN
    RAISE EXCEPTION 'Not authorized to modify this project';
  END IF;

  -- Delete files whose paths are not in the new set
  DELETE FROM public.project_files
  WHERE project_id = _project_id
    AND path NOT IN (
      SELECT (elem->>'path')::text
      FROM jsonb_array_elements(_files) elem
    );

  -- Upsert the provided files
  INSERT INTO public.project_files (project_id, path, content)
  SELECT
    _project_id,
    (elem->>'path')::text,
    COALESCE(elem->>'content', '')
  FROM jsonb_array_elements(_files) elem
  ON CONFLICT (project_id, path)
  DO UPDATE SET
    content = EXCLUDED.content,
    updated_at = now();
END;
$$;