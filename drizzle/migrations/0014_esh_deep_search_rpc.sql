create or replace function public.esh_deep_search(
  p_q text,
  p_kinds text[] default null,
  p_limit integer default 100
)
returns table(
  kind text,
  ref_id text,
  title text,
  url_path text,
  snippet text,
  meta jsonb,
  source_updated_at timestamptz,
  rank real,
  match_mode text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select btrim(coalesce(p_q, '')) as raw,
           websearch_to_tsquery('english', btrim(coalesce(p_q, ''))) as tsq
  ),
  base as (
    select i.*
    from public.esh_search_index i, q
    where q.raw <> ''
      and (p_kinds is null or i.kind = any(p_kinds))
  ),
  full_text as (
    select b.kind, b.ref_id, ts_rank_cd(b.tsv, q.tsq)::real as rank, 'text'::text as match_mode
    from base b, q
    where q.tsq is not null and b.tsv @@ q.tsq
  ),
  ident as (
    select b.kind, b.ref_id,
           greatest(
             similarity(coalesce(b.idents, ''), q.raw),
             similarity(coalesce(b.title, ''), q.raw),
             case when coalesce(b.idents, '') ilike '%' || q.raw || '%'
                    or coalesce(b.title, '') ilike '%' || q.raw || '%' then 0.9 else 0 end
           )::real as rank,
           'ident'::text as match_mode
    from base b, q
    where length(q.raw) >= 3
      and (coalesce(b.idents, '') ilike '%' || q.raw || '%'
           or coalesce(b.title, '') ilike '%' || q.raw || '%'
           or coalesce(b.idents, '') % q.raw
           or coalesce(b.title, '') % q.raw)
  ),
  merged as (
    select kind, ref_id, max(rank) as rank,
           case when bool_or(match_mode = 'text') then 'text' else 'ident' end as match_mode
    from (select * from full_text union all select * from ident) u
    group by kind, ref_id
  )
  select
    i.kind,
    i.ref_id,
    i.title,
    i.url_path,
    ts_headline('english',
      left(coalesce(nullif(i.body, ''), coalesce(i.title, '')), 60000),
      coalesce((select tsq from q), plainto_tsquery('english', (select raw from q))),
      'MaxFragments=2, MaxWords=28, MinWords=8, ShortWord=2, FragmentDelimiter= … , StartSel=<<, StopSel=>>'
    ) as snippet,
    i.meta,
    i.source_updated_at,
    m.rank,
    m.match_mode
  from merged m
  join public.esh_search_index i on i.kind = m.kind and i.ref_id = m.ref_id
  order by m.rank desc nulls last, i.source_updated_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

grant execute on function public.esh_deep_search(text, text[], integer) to authenticated, service_role;