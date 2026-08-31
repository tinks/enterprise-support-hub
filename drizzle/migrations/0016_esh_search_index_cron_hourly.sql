select cron.unschedule('esh_refresh_search_index_15min');
select cron.schedule(
  'esh_refresh_search_index_hourly',
  '7 * * * *',
  $$select public.esh_refresh_search_index();$$
);