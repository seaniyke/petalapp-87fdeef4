ALTER TABLE public.project_builds
  ADD COLUMN IF NOT EXISTS last_progress_at timestamptz,
  ADD COLUMN IF NOT EXISTS progress_label text;

ALTER TABLE public.turns
  ADD COLUMN IF NOT EXISTS last_progress_at timestamptz,
  ADD COLUMN IF NOT EXISTS progress_label text;

CREATE INDEX IF NOT EXISTS project_builds_active_progress_idx
  ON public.project_builds (last_progress_at)
  WHERE status IN ('pending', 'building');

-- A run is only stale when it has stopped producing progress. Duration alone
-- is never a reason to stop it: a large project can legitimately install,
-- compile, deploy and browser-test for far longer than any fixed clock.
CREATE OR REPLACE FUNCTION public.reap_stalled_builds()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.project_builds
  SET
    status = 'failed',
    error_message = COALESCE(
      error_message,
      'The build service stopped responding. Try again.'
    ),
    ready_at = now()
  WHERE status IN ('pending', 'building')
    AND COALESCE(last_progress_at, created_at) < now() - interval '12 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION public.reap_stalled_turns()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.turns
     SET status = 'aborted',
         ended_at = COALESCE(ended_at, now()),
         error_message = COALESCE(error_message, 'stale: no progress')
   WHERE status = 'running'
     AND COALESCE(last_progress_at, started_at) < now() - interval '12 minutes';
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stalled_turns() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stalled_turns() TO service_role;
REVOKE ALL ON FUNCTION public.reap_stalled_builds() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stalled_builds() TO service_role;