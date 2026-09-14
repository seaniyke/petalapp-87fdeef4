SELECT cron.unschedule('petal-cost-alerts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'petal-cost-alerts');

SELECT cron.schedule(
  'petal-cost-alerts',
  '0 1 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app/api/public/cron/cost-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-petal-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BUILDER_SHARED_SECRET' LIMIT 1), '')
    ),
    body := '{}'::jsonb
  );
  $$
);