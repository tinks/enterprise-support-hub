DO $$
BEGIN
  PERFORM cron.unschedule('sync-intercom-fields-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-intercom-fields-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-intercom-fields-daily',
  '20 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dzwcgqyznzrntkbobejo.supabase.co/functions/v1/sync-intercom-fields',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6d2NncXl6bnpybnRrYm9iZWpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MTk1MjgsImV4cCI6MjA4ODI5NTUyOH0.Um99UmvLllNXdB0Rb2J5asMSr6tKMUXCYLKRYOODw04"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
