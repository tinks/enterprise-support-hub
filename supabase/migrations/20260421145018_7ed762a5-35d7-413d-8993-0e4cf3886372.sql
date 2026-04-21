create table public.pending_intercom_links (
  id uuid primary key default gen_random_uuid(),
  intercom_conversation_id text not null unique,
  normalized_subject text not null,
  intercom_created_at timestamptz not null,
  contact_name text,
  contact_email text,
  resolved_owner text,
  source_payload jsonb not null,
  pre_messages jsonb not null,
  attempts int not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_pending_intercom_links_norm_subject on public.pending_intercom_links (normalized_subject);
create index idx_pending_intercom_links_created on public.pending_intercom_links (intercom_created_at);

alter table public.pending_intercom_links enable row level security;

create policy "Deny public insert pending_intercom_links"
  on public.pending_intercom_links for insert to public with check (false);

create policy "Deny public update pending_intercom_links"
  on public.pending_intercom_links for update to public using (false);

create policy "Deny public delete pending_intercom_links"
  on public.pending_intercom_links for delete to public using (false);

create policy "Allow authenticated read pending_intercom_links"
  on public.pending_intercom_links for select to authenticated using (true);
