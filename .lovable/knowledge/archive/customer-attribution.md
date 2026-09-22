# Archive: customer attribution rollout notes

Historical narrative and verification logs relocated out of `.lovable/project-knowledge.md` on 22 Sep 2026. Text is verbatim; line references are to the pre-trim file (2,697 lines).

## L1045

**Coverage RPC narrowing (migration `0034`, 4 Sep 2026).** `v3_coverage_current()` no longer materialises wide `intercom_tickets_v3` rows (it was pulling `raw_payload` into every scan); it selects only the columns the counters need and computes registry membership once. `v3_unattributed_groups()` likewise precomputes its classification/probe expressions once instead of per-branch. Grants preserved; output equivalence checked against the previous definitions. Measured after: coverage ~74ms vs a ~2.28s historical mean. _UNVERIFIED:_ unattributed-group equivalence at scale — only 3 unattributed rows exist today.

## L1091

- **Explicit dismissal (8 Sep 2026):** the registry lookup above only clears the alert when the Slack company name slugifies to an *exact* `account_key`. Real registries split a company across keys (Slack "Cars Commerce" → `cars_commerce`, registry holds `cars_commerce_us` and `cars_commerce_canada`), so the alert could not clear without inventing a third, attribution-affecting registry row. Second clearing path: `public.v3_closed_won_acknowledged_names` (`name_key` PK = same slug, `display_name`, `note`, `acknowledged_by`/`_email`, `acknowledged_at`; RLS = authenticated read, `can_edit()` insert/delete). The poller unions acknowledged `name_key`s into the handled set, so an acknowledged company lands in `missing_domain_handled[]`. Deliberately a *separate* table, not an alias column on `v3_customer_accounts` — acknowledging an alert must never change customer attribution. UI: Settings → Integration health, the closed-won row parses the health message's `blank Company Domain for "<name>"` phrase and renders a per-company **Dismiss** button that inserts the acknowledgement and immediately re-runs the poller, so the card recomputes from a real run instead of being cleared cosmetically. VERIFIED 8 Sep 2026: with `cars_commerce` acknowledged, a server-side cron-header invoke flipped `integration_health.slack_closed_won_poll` from `error` / `consecutive_failures 4` to `ok` / `0`. UNVERIFIED: the Dismiss button itself has not been clicked in the browser (backend path exercised directly).

## L1104

- **Seed (13 Aug 2026):** all 490 domains already in the registry at queue creation were inserted as `skipped` ("Pre-existing registry domain at queue creation"), so the queue starts clean and only tracks new arrivals.
