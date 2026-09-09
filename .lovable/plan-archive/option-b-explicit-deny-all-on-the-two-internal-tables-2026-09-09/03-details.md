## Technical detail

Migration `0037_deny_all_internal_tables.sql`, DDL only:

```sql
CREATE POLICY "deny_all_cron_auth" ON public.cron_auth
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_all_gmail_oauth_states" ON public.gmail_oauth_states
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.cron_auth IS
  'Service-role only. Explicit deny-all RLS for anon/authenticated.';
COMMENT ON TABLE public.gmail_oauth_states IS
  'Service-role only. Explicit deny-all RLS for anon/authenticated.';
```

`RESTRICTIVE` is deliberate: a restrictive policy can never widen access, so this can only ever confirm the current lockdown, never open it. No grants are added or removed.

## Verification (run and reported, not assumed)

1. `pg_policies` shows exactly two new policies, one per table.
2. Negative case: query each table as `authenticated` — must return permission denied / zero rows, same as before.
3. Positive case: confirm the internal paths still work — `gmail_connection_status()` still resolves, and the cron secret lookup still authorises a scheduled run. Nothing here should change, and I'll say so only after seeing it.
4. Re-run the database linter and report the remaining finding count.

## Boundaries

- Option C stays parked: `pg_trgm` stays in `public`, and none of the 29 `SECURITY DEFINER` functions are touched.
- Security batches 4 and 5 remain unstarted.
- No application code changes.

## Docs pass

Changelog row, project-knowledge via `sync-knowledge-pending` (pending, never live), and a Flow node noting the two tables are service-role only by explicit policy.
