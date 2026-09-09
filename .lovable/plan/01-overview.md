# Option B — explicit deny-all on the two internal tables

## What's actually true right now (verified)

Queried the database directly before writing this:

- `cron_auth` and `gmail_oauth_states` both have row-level security **on**.
- Both have **zero** policies.
- Neither grants any privilege to `anon` or `authenticated`.

So no signed-in or anonymous caller can read or write either table today. The only access is through the internal service role, which bypasses RLS by design. This is a **hygiene finding, not an exposure** — the linter wants the intent written down explicitly rather than inferred from an empty policy list.

## What changes

One migration adding a single explicit `RESTRICTIVE` deny-all policy per table, plus a comment on each table saying it is service-role only. Nothing else: no grants, no code, no behaviour change.
