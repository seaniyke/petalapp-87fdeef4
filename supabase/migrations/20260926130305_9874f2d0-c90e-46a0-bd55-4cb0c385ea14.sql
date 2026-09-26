-- One running generation turn per project, enforced by the database.
UPDATE public.turns
   SET status = 'failed', ended_at = now(), error_message = 'Turn ended without completing.'
 WHERE status = 'running'
   AND greatest(created_at, coalesce(heartbeat_at, created_at), coalesce(last_progress_at, created_at)) < now() - interval '10 minutes';

CREATE UNIQUE INDEX IF NOT EXISTS turns_one_running_per_project
  ON public.turns (project_id) WHERE status = 'running';

CREATE OR REPLACE FUNCTION public.claim_generation_turn(
  p_turn_id uuid, p_project_id uuid, p_user_id uuid, p_stale_seconds integer DEFAULT 600
) RETURNS TABLE (turn_id uuid, claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  -- Same client turn id already accepted: idempotent, never a second turn.
  IF EXISTS (SELECT 1 FROM turns WHERE id = p_turn_id) THEN
    RETURN QUERY SELECT p_turn_id, false; RETURN;
  END IF;
  -- Retire a running turn only when it has shown no life for the stale window.
  UPDATE turns SET status = 'failed', ended_at = now(), error_message = 'Turn ended without completing.'
   WHERE project_id = p_project_id AND status = 'running'
     AND greatest(created_at, coalesce(heartbeat_at, created_at), coalesce(last_progress_at, created_at))
         < now() - make_interval(secs => p_stale_seconds);
  INSERT INTO turns (id, project_id, user_id, status)
  VALUES (p_turn_id, p_project_id, p_user_id, 'running')
  ON CONFLICT (project_id) WHERE status = 'running' DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true; RETURN;
  END IF;
  SELECT t.id INTO v_id FROM turns t WHERE t.project_id = p_project_id AND t.status = 'running' LIMIT 1;
  RETURN QUERY SELECT v_id, false;
END $$;

REVOKE ALL ON FUNCTION public.claim_generation_turn(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_generation_turn(uuid, uuid, uuid, integer) TO service_role;