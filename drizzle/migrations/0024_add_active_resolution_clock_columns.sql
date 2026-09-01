alter table public.intercom_tickets_v3
  add column if not exists resolution_active_s integer,
  add column if not exists resolution_active_bh_s integer,
  add column if not exists resolution_closed_s integer,
  add column if not exists sla_clock_start_at timestamptz,
  add column if not exists active_clock_computed_at timestamptz,
  add column if not exists active_clock_engine_version integer;

create index if not exists intercom_tickets_v3_active_clock_version_idx
  on public.intercom_tickets_v3 (active_clock_engine_version)
  where lifecycle_status in ('finalized','reopened_after_finalize');