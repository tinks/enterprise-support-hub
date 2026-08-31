create extension if not exists pg_trgm with schema public;

create or replace function public.esh_strip_html(t text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
    regexp_replace(
      replace(replace(replace(replace(replace(replace(coalesce(t,''),
        '&nbsp;',' '), '&amp;','&'), '&quot;','"'), '&#39;',''''), '&lt;','<'), '&gt;','>'),
      '<[^>]*>', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

create table if not exists public.esh_search_index (
  kind text not null,
  ref_id text not null,
  title text,
  body text,
  idents text,
  meta jsonb not null default '{}'::jsonb,
  url_path text,
  source_updated_at timestamptz,
  indexed_at timestamptz not null default now(),
  tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(idents,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(body,'')), 'B')
  ) stored,
  primary key (kind, ref_id)
);

grant select on public.esh_search_index to authenticated;
grant all on public.esh_search_index to service_role;
alter table public.esh_search_index enable row level security;

drop policy if exists "authenticated read search index" on public.esh_search_index;
create policy "authenticated read search index" on public.esh_search_index
  for select to authenticated using (true);

create index if not exists esh_search_index_tsv_idx on public.esh_search_index using gin (tsv);
create index if not exists esh_search_index_idents_trgm on public.esh_search_index using gin (idents public.gin_trgm_ops);
create index if not exists esh_search_index_title_trgm on public.esh_search_index using gin (title public.gin_trgm_ops);
create index if not exists esh_search_index_kind_idx on public.esh_search_index (kind);