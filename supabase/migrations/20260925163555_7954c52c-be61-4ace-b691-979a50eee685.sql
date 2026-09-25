-- Prompt 11: one authoritative PROJECT CODE revision.
-- projects.revision   = identity of the current project_files state (not memory, not builds).
-- turns.base_revision = project revision when the turn started (optimistic-concurrency base).
-- turns.committed_revision = revision this turn created (NULL = created none).
-- project_builds.project_revision = revision the build was made from (NULL = legacy/unknown,
--   never eligible to establish current readiness). stale_reason records rejected late results.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;
ALTER TABLE public.turns ADD COLUMN IF NOT EXISTS base_revision bigint;
ALTER TABLE public.turns ADD COLUMN IF NOT EXISTS committed_revision bigint;
ALTER TABLE public.project_builds ADD COLUMN IF NOT EXISTS project_revision bigint;
ALTER TABLE public.project_builds ADD COLUMN IF NOT EXISTS stale_reason text;

-- Capture the base revision when a turn row is created.
CREATE OR REPLACE FUNCTION public.set_turn_base_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.base_revision IS NULL AND NEW.project_id IS NOT NULL THEN
    SELECT revision INTO NEW.base_revision FROM public.projects WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_turn_base_revision ON public.turns;
CREATE TRIGGER trg_turn_base_revision BEFORE INSERT ON public.turns
  FOR EACH ROW EXECUTE FUNCTION public.set_turn_base_revision();

-- Direct project_files writes (installers, missing-package fix, backups, remix copy) advance
-- the revision once per statement when code actually changed. replace_project_files manages
-- its own single increment and sets kimble.revision_managed so these triggers stand down.
CREATE OR REPLACE FUNCTION public.bump_revision_on_file_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('kimble.revision_managed', true), '') = 'on' THEN RETURN NULL; END IF;
  UPDATE public.projects p SET revision = p.revision + 1
  WHERE p.id IN (SELECT DISTINCT project_id FROM new_rows);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.bump_revision_on_file_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('kimble.revision_managed', true), '') = 'on' THEN RETURN NULL; END IF;
  UPDATE public.projects p SET revision = p.revision + 1
  WHERE p.id IN (SELECT DISTINCT project_id FROM old_rows);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.bump_revision_on_file_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('kimble.revision_managed', true), '') = 'on' THEN RETURN NULL; END IF;
  UPDATE public.projects p SET revision = p.revision + 1
  WHERE p.id IN (
    SELECT DISTINCT n.project_id FROM new_rows n JOIN old_rows o ON o.id = n.id
    WHERE n.content IS DISTINCT FROM o.content OR n.path IS DISTINCT FROM o.path
  );
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_files_rev_ins ON public.project_files;
DROP TRIGGER IF EXISTS trg_files_rev_del ON public.project_files;
DROP TRIGGER IF EXISTS trg_files_rev_upd ON public.project_files;
CREATE TRIGGER trg_files_rev_ins AFTER INSERT ON public.project_files
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_revision_on_file_insert();
CREATE TRIGGER trg_files_rev_del AFTER DELETE ON public.project_files
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_revision_on_file_delete();
CREATE TRIGGER trg_files_rev_upd AFTER UPDATE ON public.project_files
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_revision_on_file_update();

-- The one full-tree save. Files + revision + turn.committed_revision in ONE transaction.
-- Returns the project revision after the call (unchanged when the tree was identical).
DROP FUNCTION IF EXISTS public.replace_project_files(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.replace_project_files(
  _project_id uuid,
  _files jsonb,
  _turn_id uuid DEFAULT NULL,
  _check_base boolean DEFAULT true
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _current bigint;
  _base bigint;
  _changed boolean;
BEGIN
  IF auth.role() <> 'service_role' AND NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id
      AND (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  ) THEN
    RAISE EXCEPTION 'Not authorized to modify this project';
  END IF;

  -- Serialises every full-tree save for this project (row lock until commit).
  SELECT revision INTO _current FROM public.projects WHERE id = _project_id FOR UPDATE;
  IF _current IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF _turn_id IS NOT NULL AND _check_base THEN
    SELECT base_revision INTO _base FROM public.turns WHERE id = _turn_id AND project_id = _project_id;
    IF _base IS NOT NULL AND _base <> _current THEN
      RAISE EXCEPTION 'revision_conflict: project is at revision % but this change was made against revision %', _current, _base
        USING ERRCODE = '40001';
    END IF;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rpf_incoming (path text PRIMARY KEY, content text) ON COMMIT DROP;
  TRUNCATE _rpf_incoming;
  INSERT INTO _rpf_incoming (path, content)
  SELECT DISTINCT ON (path) path, content
  FROM (
    SELECT ord, NULLIF(BTRIM(elem->>'path'), '')::text AS path, COALESCE(elem->>'content', '') AS content
    FROM jsonb_array_elements(_files) WITH ORDINALITY AS f(elem, ord)
  ) parsed
  WHERE path IS NOT NULL
  ORDER BY path, ord DESC;

  _changed :=
    EXISTS (SELECT 1 FROM public.project_files pf WHERE pf.project_id = _project_id
            AND NOT EXISTS (SELECT 1 FROM _rpf_incoming i WHERE i.path = pf.path))
    OR EXISTS (SELECT 1 FROM _rpf_incoming i WHERE NOT EXISTS (
            SELECT 1 FROM public.project_files pf
            WHERE pf.project_id = _project_id AND pf.path = i.path AND pf.content = i.content));

  IF NOT _changed THEN
    RETURN _current;
  END IF;

  PERFORM set_config('kimble.revision_managed', 'on', true);

  DELETE FROM public.project_files pf
  WHERE pf.project_id = _project_id
    AND NOT EXISTS (SELECT 1 FROM _rpf_incoming i WHERE i.path = pf.path);

  INSERT INTO public.project_files (project_id, path, content)
  SELECT _project_id, path, content FROM _rpf_incoming
  ON CONFLICT (project_id, path)
  DO UPDATE SET content = EXCLUDED.content, updated_at = now()
  WHERE public.project_files.content IS DISTINCT FROM EXCLUDED.content;

  PERFORM set_config('kimble.revision_managed', '', true);

  UPDATE public.projects SET revision = revision + 1 WHERE id = _project_id
  RETURNING revision INTO _current;

  IF _turn_id IS NOT NULL THEN
    UPDATE public.turns SET committed_revision = _current
    WHERE id = _turn_id AND project_id = _project_id;
  END IF;

  RETURN _current;
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_project_files(uuid, jsonb, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_project_files(uuid, jsonb, uuid, boolean) TO authenticated, service_role;