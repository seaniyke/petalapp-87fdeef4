-- Lets the server (service role only) refresh the vault copy of the build
-- server secret that background jobs send, so it can never drift from the
-- secret the app actually checks.
CREATE OR REPLACE FUNCTION public.sync_builder_cron_secret(_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  IF _value IS NULL OR length(_value) < 32 THEN
    RAISE EXCEPTION 'invalid secret';
  END IF;
  SELECT id INTO _id FROM vault.secrets WHERE name = 'BUILDER_SHARED_SECRET' LIMIT 1;
  IF _id IS NULL THEN
    PERFORM vault.create_secret(_value, 'BUILDER_SHARED_SECRET');
  ELSE
    PERFORM vault.update_secret(_id, _value);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_builder_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_builder_cron_secret(text) TO service_role;

-- Recovery jobs run the real build callback (probe + database writes); the
-- default 5s HTTP timeout cancels them mid-way. Give them a minute.
SELECT cron.alter_job(
  jobid,
  command := regexp_replace(command, 'body\s*:=\s*(''[^'']*''::jsonb)', 'body := \1, timeout_milliseconds := 60000')
)
FROM cron.job
WHERE jobname IN ('petal-build-watchdog', 'petal-turn-resume')
  AND position('timeout_milliseconds' in command) = 0;