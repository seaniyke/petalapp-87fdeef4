-- Durable build checkpoints: finished work of a long first build survives a
-- lost build server and is resumed, never redone.
CREATE TABLE public.build_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  origin_turn_id uuid NOT NULL,
  turn_id uuid NOT NULL,
  base_revision bigint,
  request text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'shell',
  shell jsonb,
  planned jsonb NOT NULL DEFAULT '[]'::jsonb,
  pages jsonb NOT NULL DEFAULT '{}'::jsonb,
  remaining jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resumable','resuming','consumed','discarded')),
  resume_count integer NOT NULL DEFAULT 0,
  preserved jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.build_checkpoints TO authenticated;
GRANT ALL ON public.build_checkpoints TO service_role;
ALTER TABLE public.build_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can view their build checkpoints" ON public.build_checkpoints
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- At most one live checkpoint per project.
CREATE UNIQUE INDEX build_checkpoints_one_live_per_project
  ON public.build_checkpoints(project_id) WHERE status IN ('active','resumable','resuming');
CREATE INDEX build_checkpoints_turn ON public.build_checkpoints(turn_id);

-- Atomic page merge, only by the turn that currently owns the checkpoint
-- (a lost worker that wakes up after a resume took over cannot write).
CREATE OR REPLACE FUNCTION public.checkpoint_merge_pages(_turn_id uuid, _pages jsonb, _remaining jsonb, _stage text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.build_checkpoints
     SET pages = pages || coalesce(_pages, '{}'::jsonb),
         remaining = coalesce(_remaining, remaining),
         stage = coalesce(_stage, stage),
         updated_at = now()
   WHERE turn_id = _turn_id AND status IN ('active','resuming');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.checkpoint_merge_pages(uuid, jsonb, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_merge_pages(uuid, jsonb, jsonb, text) TO service_role;

-- Reaper: a lost worker with a usable checkpoint becomes RESUMABLE and is
-- queued for the resume worker; everything else behaves as before.
CREATE OR REPLACE FUNCTION public.reap_stalled_turns()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  UPDATE public.turns t
     SET status = 'succeeded',
         ended_at = COALESCE(t.ended_at, now())
   WHERE t.status = 'running'
     AND t.committed_at IS NOT NULL
     AND COALESCE(t.heartbeat_at, t.last_progress_at, t.started_at) < now() - interval '3 minutes'
     AND EXISTS (SELECT 1 FROM public.turn_events e WHERE e.turn_id = t.id AND e.kind = 'result');

  -- Lost worker WITH a checkpoint → resumable.
  FOR r IN
    SELECT t.id AS turn_id, c.id AS cp_id, c.request
      FROM public.turns t
      JOIN public.build_checkpoints c ON c.turn_id = t.id AND c.status IN ('active','resuming') AND c.shell IS NOT NULL
     WHERE t.status = 'running'
       AND t.committed_at IS NULL
       AND t.heartbeat_at IS NOT NULL
       AND GREATEST(t.heartbeat_at, COALESCE(t.last_progress_at, t.heartbeat_at)) < now() - interval '3 minutes'
  LOOP
    UPDATE public.build_checkpoints SET status = 'resumable', updated_at = now() WHERE id = r.cp_id;
    UPDATE public.project_turn_completion
       SET stage = 'needs_repair',
           outstanding_defects = jsonb_build_array(left(r.request, 4000)),
           evidence = '["interrupted_generation"]'::jsonb,
           terminal_reason = NULL,
           resume_after = now()
     WHERE turn_id = r.turn_id AND attempts < max_attempts;
    UPDATE public.turns
       SET status = 'failed',
           ended_at = COALESCE(ended_at, now()),
           error_message = 'worker_lost_resumable: the build server stopped responding; finished work is saved and will be resumed'
     WHERE id = r.turn_id AND status = 'running';
  END LOOP;

  UPDATE public.turns
     SET status = 'failed',
         ended_at = COALESCE(ended_at, now()),
         error_message = COALESCE(error_message, 'worker_lost: the build server stopped responding')
   WHERE status = 'running'
     AND heartbeat_at IS NOT NULL
     AND GREATEST(heartbeat_at, COALESCE(last_progress_at, heartbeat_at)) < now() - interval '3 minutes';

  UPDATE public.turns
     SET status = 'failed',
         ended_at = COALESCE(ended_at, now()),
         error_message = COALESCE(error_message, 'worker_never_started: the build service never picked this build up')
   WHERE status = 'running'
     AND heartbeat_at IS NULL
     AND COALESCE(last_progress_at, started_at) < now() - interval '5 minutes';
END;
$function$;
REVOKE ALL ON FUNCTION public.reap_stalled_turns() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stalled_turns() TO service_role;

CREATE OR REPLACE FUNCTION public.close_turn_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'running' AND NEW.status IN ('failed','cancelled') THEN
    UPDATE turn_economics
       SET result = NEW.status,
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
             'closed_by','terminal_trigger','closed_at',now(),'terminal_error',NEW.error_message),
           updated_at = now()
     WHERE turn_id = NEW.id::text AND result = 'running';
    IF NOT EXISTS (
      SELECT 1 FROM messages m
       WHERE m.project_id = NEW.project_id AND m.role = 'assistant' AND m.created_at >= NEW.created_at
    ) THEN
      INSERT INTO messages (project_id, role, content) VALUES (
        NEW.project_id, 'assistant',
        CASE
          WHEN NEW.status = 'cancelled'
            THEN 'This build was stopped. Your project was left exactly as it was, and nothing was charged.'
          WHEN NEW.error_message LIKE 'worker_lost_resumable%'
            THEN 'The Kimble build server restarted partway through this build. The work already finished is saved, and Kimble will pick up from there automatically — it won''t start over. Nothing was charged for the interruption.'
          ELSE 'This build stopped before finishing because the Kimble build server stopped responding — not because of your request. Your project was left exactly as it was, and nothing was charged. Send your message again and Kimble will pick it back up.'
        END);
    END IF;
  END IF;
  RETURN NEW;
END $function$;