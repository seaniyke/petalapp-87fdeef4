DO $$
DECLARE
  v_secret text;
BEGIN
  -- Grab the shared cron secret if it has been configured. If not, leave the
  -- header blank — the endpoint will refuse the call but the schedule still
  -- exists for once the secret is added.
  BEGIN
    SELECT current_setting('app.builder_shared_secret', true) INTO v_secret;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  -- Unschedule any prior copy first (idempotent).
  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname = 'runtime-backend-hourly';

  PERFORM cron.schedule(
    'runtime-backend-hourly',
    '0 * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app/api/public/cron/runtime-backend-hour',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-petal-cron-secret', coalesce(current_setting('app.builder_shared_secret', true), '')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
END $$;