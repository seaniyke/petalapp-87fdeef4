-- Schedule the daily self-learning digest at 00:00 UTC.
-- Uses pg_net to POST to the stable project URL with the cron secret.
--
-- The shared secret is read from Vault (where BUILDER_SHARED_SECRET is mirrored
-- for use by pg_cron). If Vault doesn't have it yet, the job will 401 until
-- the secret is populated — that's logged and harmless.
--
-- Idempotent: drops any existing job with the same name first.

select cron.unschedule('petal-self-learning-digest-daily')
where exists (select 1 from cron.job where jobname = 'petal-self-learning-digest-daily');

select
  cron.schedule(
    'petal-self-learning-digest-daily',
    '0 0 * * *',
    $$
    select net.http_post(
      url := 'https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app/api/public/cron/self-learning-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-petal-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'BUILDER_SHARED_SECRET' limit 1), '')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
    $$
  );