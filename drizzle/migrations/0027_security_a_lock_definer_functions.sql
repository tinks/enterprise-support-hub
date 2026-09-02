-- Security batch A: pin search_path on the one mutable function, and stop
-- unauthenticated (anon/public) execution of every SECURITY DEFINER function.
-- Signed-in users and the service role keep execute; extension-owned functions
-- (pg_trgm) are left alone.
alter function public.esh_strip_html(text) set search_path = public;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;