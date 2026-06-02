DO $$
DECLARE
  req_id bigint;
BEGIN
  SELECT net.http_post(
    url := 'https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c-dev.lovable.app/api/public/cron/subscription-renewal-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-petal-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BUILDER_SHARED_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO req_id;
  RAISE NOTICE 'subscription-renewal-reminder backfill request_id=%', req_id;
END
$$;