# Consolidate customer records onto the Registry

## What I found

They are not two data sets. Both surfaces read and write the **same table** (`v3_customer_accounts`) — it's one source of truth with two editors, so there is no mirror to reconcile and no data to migrate.

The difference is field coverage:

| Field | Settings → Customer accounts | Customers → Registry |
|---|---|---|
| account_key, label, domains, notes | yes | yes |
| aliases | no | yes |
| tier | no | yes |
| csm_owner | no | yes |
| status (active / inactive / prospect) | no | yes |
| ticket counts | counts every ticket row incl. non-account keys | uses `v3_accounts_usage()` (registry-scoped) |
| search | no | yes |
| orphan-override reconciliation, workspace map, internal channels | no | yes |

So the Settings card is a strict subset. It is also mildly hazardous: creating an account there produces a row with no `status`, no `tier`, no `aliases` — exactly the kind of half-populated registry row the resolver and the Coverage tab then have to explain. (Editing there is safe — it only writes its four fields — but that's luck, not design.)

Neither editor exposes `is_test`; that stays a manual field either way.

## The change

Retire the Settings card and make the Registry the single place.

1. Remove `<CustomerAccountsCard />` from the Settings page (`src/pages/Index.tsx`).
2. In its place, add a one-line pointer card: "Customer accounts have moved to Admin → Customers → Registry" with a link to `/customers?tab=registry`, so anyone with the old muscle memory lands in the right spot instead of finding nothing.
3. Delete `src/components/CustomerAccountsCard.tsx` (no other importer).
4. Confirm the Registry tab is reachable via a `tab` query param; if it isn't, add that param handling so the pointer link opens directly on Registry.

No migration, no schema change, no resolver change, no edge-function change. Data is untouched.

## Verification

- Settings renders without the accounts table and with the pointer link.
- `/customers?tab=registry` opens on the Registry tab and lists the same accounts (same count as before).
- `tsgo --noEmit` clean; no dangling imports.

## Docs

Per the standing convention, this is a surface change with a real behavioral consequence (one editor, full field set), so it gets a knowledge + Flow entry: note in `.lovable/project-knowledge.md` (via `sync-knowledge-pending`) and `FlowDiagram.tsx` that `v3_customer_accounts` is edited only from Customers → Registry, and a `changelog_entries` row. Say the word if you'd rather keep that as a separate docs pass.
