SELECT cron.schedule(
  'petal-subscription-renewal-reminder-daily',
  '0 9 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://petalapp.lovable.app/api/public/cron/subscription-renewal-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-petal-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BUILDER_SHARED_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);