ALTER TABLE public.turns
  ADD COLUMN IF NOT EXISTS worker_lease text,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_turn_heartbeat(_turn_id uuid, _lease text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status text;
  _holder text;
BEGIN
  UPDATE public.turns
     SET worker_lease = _lease, heartbeat_at = now()
   WHERE id = _turn_id
     AND status = 'running'
     AND (worker_lease IS NULL OR worker_lease = _lease);
  IF FOUND THEN RETURN 'ok'; END IF;
  SELECT status::text, worker_lease INTO _status, _holder FROM public.turns WHERE id = _turn_id;
  IF _status IS NULL OR _status <> 'running' THEN RETURN 'terminal'; END IF;
  RETURN 'lost';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_turn_heartbeat(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_turn_heartbeat(uuid, text) TO service_role;

-- Reconcile stalled turns every minute:
--  * worker heartbeat silent 3 min -> worker lost
--  * no heartbeat ever (legacy) -> 12 min without progress
--  * a persisted final result whose terminal write was lost -> succeeded
CREATE OR REPLACE FUNCTION public.reap_stalled_turns()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.turns t
     SET status = 'succeeded',
         ended_at = COALESCE(t.ended_at, now())
   WHERE t.status = 'running'
     AND t.committed_at IS NOT NULL
     AND COALESCE(t.heartbeat_at, t.last_progress_at, t.started_at) < now() - interval '3 minutes'
     AND EXISTS (SELECT 1 FROM public.turn_events e WHERE e.turn_id = t.id AND e.kind = 'result');

  UPDATE public.turns
     SET status = 'failed',
         ended_at = COALESCE(ended_at, now()),
         error_message = COALESCE(error_message, 'worker_lost: the build server stopped responding')
   WHERE status = 'running'
     AND heartbeat_at IS NOT NULL
     AND GREATEST(heartbeat_at, COALESCE(last_progress_at, heartbeat_at)) < now() - interval '3 minutes';

  UPDATE public.turns
     SET status = 'aborted',
         ended_at = COALESCE(ended_at, now()),
         error_message = COALESCE(error_message, 'stale: no progress')
   WHERE status = 'running'
     AND heartbeat_at IS NULL
     AND COALESCE(last_progress_at, started_at) < now() - interval '12 minutes';
END;
$$;
REVOKE ALL ON FUNCTION public.reap_stalled_turns() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stalled_turns() TO service_role;