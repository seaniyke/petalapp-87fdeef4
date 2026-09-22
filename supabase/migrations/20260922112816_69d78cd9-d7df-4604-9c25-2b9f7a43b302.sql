-- lovable-cron-fallback-reviewed: 720 runs/day; rescues builds the build service silently dropped. The browser watchdog only runs with the tab open, and there is no row-change event for "the builder never called back", so a timer is the only trigger.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'petal-build-watchdog') THEN
    PERFORM cron.unschedule('petal-build-watchdog');
  END IF;
  PERFORM cron.schedule(
    'petal-build-watchdog',
    '*/2 * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app/api/public/cron/build-watchdog',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-petal-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BUILDER_SHARED_SECRET' LIMIT 1), '')
      ),
      body := '{}'::jsonb
    );
    $job$
  );
END $$;