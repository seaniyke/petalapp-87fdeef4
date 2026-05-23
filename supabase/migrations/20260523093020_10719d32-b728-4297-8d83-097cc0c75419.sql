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
  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id
      AND (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  ) THEN
    RAISE EXCEPTION 'Not authorized to modify this project';
  END IF;

  WITH deduped AS (
    SELECT DISTINCT ON (path)
      path,
      content
    FROM (
      SELECT
        ord,
        NULLIF(BTRIM(elem->>'path'), '')::text AS path,
        COALESCE(elem->>'content', '') AS content
      FROM jsonb_array_elements(_files) WITH ORDINALITY AS f(elem, ord)
    ) parsed
    WHERE path IS NOT NULL
    ORDER BY path, ord DESC
  )
  DELETE FROM public.project_files pf
  WHERE pf.project_id = _project_id
    AND NOT EXISTS (
      SELECT 1 FROM deduped d WHERE d.path = pf.path
    );

  WITH deduped AS (
    SELECT DISTINCT ON (path)
      path,
      content
    FROM (
      SELECT
        ord,
        NULLIF(BTRIM(elem->>'path'), '')::text AS path,
        COALESCE(elem->>'content', '') AS content
      FROM jsonb_array_elements(_files) WITH ORDINALITY AS f(elem, ord)
    ) parsed
    WHERE path IS NOT NULL
    ORDER BY path, ord DESC
  )
  INSERT INTO public.project_files (project_id, path, content)
  SELECT _project_id, path, content
  FROM deduped
  ON CONFLICT (project_id, path)
  DO UPDATE SET
    content = EXCLUDED.content,
    updated_at = now();
END;
$$;