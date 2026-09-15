DO $$
DECLARE
  src TEXT;
BEGIN
  SELECT command INTO src FROM cron.job WHERE jobname = 'petal-turn-resume';
  IF src IS NULL THEN
    RAISE NOTICE 'petal-turn-resume job not found; skipping thumbnail backfill schedule';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'petal-thumbnail-backfill') THEN
    PERFORM cron.unschedule('petal-thumbnail-backfill');
  END IF;
  PERFORM cron.schedule(
    'petal-thumbnail-backfill',
    '25 * * * *',
    replace(src, 'cron/turn-resume', 'cron/thumbnail-backfill')
  );
END $$;