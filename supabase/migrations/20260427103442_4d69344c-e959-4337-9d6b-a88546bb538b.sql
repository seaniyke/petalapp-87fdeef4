CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior schedule with the same name (idempotent re-runs).
DO $$
BEGIN
  PERFORM cron.unschedule('petal-backend-slots-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'petal-backend-slots-daily',
  '0 9 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://petalapp.lovable.app/api/public/cron/backend-slots',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-petal-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BUILDER_SHARED_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);