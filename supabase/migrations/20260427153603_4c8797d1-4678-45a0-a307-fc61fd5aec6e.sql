-- Make sure the cron extension is available (idempotent).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function: flip any build that has been pending/building for >10 minutes
-- to "failed" with a clear timeout message. The UI will then show the
-- friendly "deploy stalled" card with a Retry button.
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
      'Build timed out — the deploy service did not report back within 10 minutes. Try publishing again.'
    ),
    ready_at = now()
  WHERE status IN ('pending', 'building')
    AND created_at < now() - interval '10 minutes';
END;
$$;

-- Schedule it every minute. Safe to re-run: unschedule first if it exists.
DO $$
BEGIN
  PERFORM cron.unschedule('reap-stalled-builds');
EXCEPTION WHEN OTHERS THEN
  -- job didn't exist yet — fine
  NULL;
END $$;

SELECT cron.schedule(
  'reap-stalled-builds',
  '* * * * *',
  $$ SELECT public.reap_stalled_builds(); $$
);

-- Also run it once right now to clear today's stranded rows.
SELECT public.reap_stalled_builds();
