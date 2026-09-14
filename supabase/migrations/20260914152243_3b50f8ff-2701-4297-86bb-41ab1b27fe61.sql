-- lovable-cron-fallback-reviewed: 288 runs/day; backstop for abandoned build-repair loops — the live browser session handles the common case, this only catches requests whose tab closed, and there is no row-change event to hook because the trigger is "nobody resumed within the grace window".
SELECT cron.schedule(
  'petal-turn-resume',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app/api/public/cron/turn-resume',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-petal-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BUILDER_SHARED_SECRET' LIMIT 1), '')
    ),
    body := '{}'::jsonb
  );
  $$
);