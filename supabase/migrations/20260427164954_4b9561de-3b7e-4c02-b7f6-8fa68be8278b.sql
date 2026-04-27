-- Root cause: the previous reaper killed any build still pending after 10
-- minutes, but the builder's own worst-case path (npm install up to 4 min +
-- vite build up to 3 min + wrangler project create up to 1.5 min + wrangler
-- deploy up to 3 min) can legitimately take ~11.5 min on a cold Railway
-- container with no warm npm cache. Add Railway cold start + queue wait and
-- a healthy first build can take 12–15 min, after which the shared npm
-- cache makes subsequent builds much faster.
--
-- Fix: extend the reaper grace period from 10 → 20 minutes. The schedule
-- stays at every-minute, so the UI still recovers within ~1 minute once a
-- build crosses the new threshold. The builder's own per-step timeouts
-- (defined in builder/src/build.ts) remain the real safety net — the reaper
-- is only the backstop for cases where the builder process disappears
-- entirely.

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
      'Build timed out — the deploy service did not report back within 20 minutes. Try publishing again.'
    ),
    ready_at = now()
  WHERE status IN ('pending', 'building')
    AND created_at < now() - interval '20 minutes';
END;
$$;

-- Run once now to recompute eligibility under the new window. Anything
-- currently pending that is <20 minutes old will be left alone and given
-- a chance to complete normally.
SELECT public.reap_stalled_builds();