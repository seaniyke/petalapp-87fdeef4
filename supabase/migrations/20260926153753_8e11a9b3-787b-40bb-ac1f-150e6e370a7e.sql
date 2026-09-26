CREATE OR REPLACE FUNCTION public.reap_stalled_turns()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Lost terminal write for a committed turn with a result → succeeded.
  UPDATE public.turns t
     SET status = 'succeeded',
         ended_at = COALESCE(t.ended_at, now())
   WHERE t.status = 'running'
     AND t.committed_at IS NOT NULL
     AND COALESCE(t.heartbeat_at, t.last_progress_at, t.started_at) < now() - interval '3 minutes'
     AND EXISTS (SELECT 1 FROM public.turn_events e WHERE e.turn_id = t.id AND e.kind = 'result');

  -- A worker that was heartbeating went silent → failed.
  UPDATE public.turns
     SET status = 'failed',
         ended_at = COALESCE(ended_at, now()),
         error_message = COALESCE(error_message, 'worker_lost: the build server stopped responding')
   WHERE status = 'running'
     AND heartbeat_at IS NOT NULL
     AND GREATEST(heartbeat_at, COALESCE(last_progress_at, heartbeat_at)) < now() - interval '3 minutes';

  -- No worker ever picked the turn up (no heartbeat, no activity) → failed.
  -- Activity-based: any progress keeps the turn alive.
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