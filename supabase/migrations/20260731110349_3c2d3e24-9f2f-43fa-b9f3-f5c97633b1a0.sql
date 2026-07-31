CREATE OR REPLACE FUNCTION public.reap_stalled_builds()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Previously every stalled build waited a full 20 minutes keyed off
  -- created_at, so a user whose tab was closed (and therefore whose
  -- client-side watchdog never fired) stared at a spinner long after the
  -- build was dead. Measure inactivity from the most recent retry instead,
  -- and use a much tighter window: a normal build finishes in well under a
  -- minute.
  UPDATE public.project_builds
  SET
    status = 'failed',
    error_message = COALESCE(
      error_message,
      'The build service stopped responding. Nothing was lost — press Retry to build again.'
    ),
    ready_at = now()
  WHERE status = 'pending'
    AND COALESCE(last_retry_at, created_at) < now() - interval '6 minutes';

  -- 'building' means the service did check in, so give it more room before
  -- declaring it dead.
  UPDATE public.project_builds
  SET
    status = 'failed',
    error_message = COALESCE(
      error_message,
      'The build ran too long and was stopped. Try publishing again.'
    ),
    ready_at = now()
  WHERE status = 'building'
    AND COALESCE(last_retry_at, created_at) < now() - interval '12 minutes';
END;
$$;