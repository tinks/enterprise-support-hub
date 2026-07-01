---
name: v3 Customer slices
description: v3_customer_accounts + personal-email allowlist + trigger-driven customer_key derivation + Inbox v3 override UI + Analytics v3 Top customers
type: feature
---

## Tables
- `public.v3_customer_accounts` (`account_key` PK, `label`, `domains text[]`, `notes`). Admin-only writes via `has_role(auth.uid(),'admin')`; any authenticated user can read.
- `public.v3_personal_email_domains` (allowlist of consumer email providers). Same RLS pattern.
- Ticket columns on `intercom_tickets_v3`: `customer_key`, `customer_kind`, `customer_source`, `customer_override_key`, `customer_override_by/at/reason`.

## Derivation rules (ordered) — LOCKSTEP CONTRACT
1. `customer_override_key` → use it (kind inferred from prefix)
2. Contact-email domain matches a `v3_customer_accounts.domains` entry → account
3. Contact-email domain in `v3_personal_email_domains` → `domain:_personal`
4. Otherwise → `domain:<lowercased-domain>`
5. No email → `unknown`

Three implementations that MUST stay in lockstep — edit all three when rules change:
- SQL: `public.v3_derive_customer` (authoritative; called by ticket BEFORE INSERT/UPDATE trigger `intercom_tickets_v3_apply_customer`)
- SQL: `public.v3_customer_accounts_propagate` (accounts-table AFTER trigger — bumps `updated_at` on tickets whose `contact_domain` intersects added/removed domains, which re-fires the derive trigger)
- Deno: `supabase/functions/_shared/v3-customer.ts` (`resolveV3Customer()` — thin wrapper over the SQL function; sync-time convenience)

## Domain-collision guard
`BEFORE INSERT/UPDATE` trigger on `v3_customer_accounts` rejects any domain already claimed by another account. Domains are lower-cased and de-duplicated on save.

## Backfill
`SELECT public.backfill_v3_customer_keys(_force boolean, _batch integer)` — batches of 5,000. Pass `force=true` to recompute every row (needed after rule/allowlist edits); `force=false` only fills NULLs.

## UI
- **Settings → Customer accounts** (`src/components/CustomerAccountsCard.tsx`, admin-only) — CRUD dialog, per-account ticket count computed from a single `intercom_tickets_v3.customer_key` scan.
- **Inbox v3 → Ticket sheet** — Customer badge + override picker (dropdown of accounts / personal / unknown) + optional reason + "Reset to auto". Not admin-gated.
- **Analytics v3** — Customer multi-select filter (applies upstream of all KPIs/charts) + "Top customers" table (closed, avg CSAT, median resolve, open, reopened). Row click → `/inbox-v3?customer=<key>`.

## Sync integration
`sync-v3-closed` and `sync-v3-open` do NOT compute `customer_*` themselves — the DB trigger fires on every upsert. Both functions carry a comment pointing at the trigger + Deno helper for lockstep awareness.
