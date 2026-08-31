-- lovable-cron-fallback-reviewed: 96 runs/day; derived search index must reflect newly synced tickets within 15 minutes, manual reindex also available
select cron.schedule(
  'esh_refresh_search_index_15min',
  '*/15 * * * *',
  $$select public.esh_refresh_search_index();$$
);