SELECT cron.schedule(
  'petal-backend-autoscale-daily',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://petalapp.lovable.app/api/public/cron/backend-autoscale',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-petal-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BUILDER_SHARED_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);