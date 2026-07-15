
## Scope

Documentation only. No SQL, RPC, edge-function, or UI behavior changes. Two files touched:

1. `.lovable/project-knowledge.md` — surgical edits inside `## v3 Customer resolution (Track A)` (lines 826–892).
2. `src/pages/FlowDiagram.tsx` — update the `customer-resolution` node bullets (around lines 785–802) to reflect the new Rule 0 and in-scope coverage.

## Edits to `.lovable/project-knowledge.md`

### A. Resolver — LOCKSTEP contract (lines 851–867)

Prepend a new Rule 0 above the current override rule and renumber the rest:

> **0. population gate** — if the ticket's Intercom `tags` contain `enterprise-not-enterprise`, resolve to `customer_key/kind/method = 'not_enterprise'` (confidence `high`). Evaluated ABOVE override so an out-of-scope ticket is excluded even if an override was set.
>
> _Why:_ whether a ticket is Enterprise work is a *population* question, separate from *which customer* it is. It's driven by a ticket tag (not an account field) because enterprise-ness is temporal — a ticket reflects the customer's status at its moment. Because the gate reads the live tag, removing the label re-derives the ticket normally on the next write/sync (future-proof if the company later upgrades/returns to Enterprise).

Add a short note under the lockstep bullets:

- `v3_derive_customer` signature is now `(_contact_email, _override_key, _contact_domain, _slack_channel_id_detected, _workspace_id_detected, _tags text[])` — 6 args. The old 5-arg and 2-arg overloads were dropped; a single canonical function remains.
- BEFORE trigger `intercom_tickets_v3_apply_customer` passes `NEW.tags`; `backfill_v3_customer_keys` passes each ticket's tags; Deno `_shared/v3-customer.ts` passes `_tags`. All lockstep components updated.

### B. Data model (lines 830–840)

Append to the `intercom_tickets_v3` columns bullet: `customer_kind` and `customer_resolution_method` now include the value `not_enterprise`.

### C. Verified coverage (line 871)

Extend the paragraph to document:

- `v3_coverage_current()` now returns `excluded_not_enterprise` (count of tickets gated to `not_enterprise`) and `population` (= `total_tickets − excluded_not_enterprise`).
- `pct_attributed` is now computed over `population` (in-scope tickets), NOT over `total_tickets`.
- `v3_coverage_snapshots` gained an `excluded_not_enterprise` column, persisted by `v3_capture_coverage_snapshot()`.
- _Why:_ excluding out-of-scope tickets from the denominator keeps coverage honest — an assist to a non-Enterprise party shouldn't count for or against attribution. The excluded count is shown, never silently dropped.

### D. UI — `/customers` Coverage tab (line 875)

Extend the Coverage bullet: adds a **"Non-Enterprise (excluded)"** KPI card (with tooltip); the attributed line now reads "N of {population} in-scope tickets".

### E. Design principles (lines 887–891)

Replace the single prospect bullet with the three-way taxonomy:

- **not-enterprise** — never an Enterprise customer / out of scope (e.g. a Support Engineer assisting a non-Enterprise party) → `enterprise-not-enterprise` tag → excluded from the population.
- **prospect** — pre-sales inbound (pricing, security, exploring upgrade) → `enterprise-prospect` tag + a real registry account → counted (pre-sales load).
- **customer (incl. former)** — is or was a real Enterprise customer, even briefly (e.g. a churned/torn-down account) → plain registry account, no tag → attributed and counted.

Note: all three ride on the ticket (Intercom tags, read-only), not a mutable account field, because status is temporal.

## Edits to `src/pages/FlowDiagram.tsx`

In the `customer-resolution` node (around lines 785–802):

- Rewrite the resolver-order bullet (line 793) to start with the population gate:
  `Resolver order (first match wins): tag 'enterprise-not-enterprise' → 'not_enterprise' (population gate, short-circuits before override) → override → slack_channel (mapped, non-internal) → domain (…) → workspace_id (medium) → 'unattributed'.`
- Update the LOCKSTEP bullet (line 794) to mention the new 6th arg `_tags text[]` on `v3_derive_customer` and that the BEFORE trigger + backfill + Deno wrapper all pass tags.
- Update the coverage bullet (line 798) to say `pct_attributed` is computed over `population` = `total_tickets − excluded_not_enterprise`, and that `v3_coverage_current` / `v3_coverage_snapshots` expose `excluded_not_enterprise`.
- Update the UI bullet (line 799) to mention the new "Non-Enterprise (excluded)" KPI card and the "N of {population} in-scope tickets" label.
- Replace the "prospects are real accounts" clause in the design-principles bullet (line 802) with the three-way not-enterprise / prospect / customer taxonomy summary.

## Reconciliation notes

Before writing, each statement will be re-checked against the current code (`_shared/v3-customer.ts`, `src/pages/Customers.tsx`, existing knowledge doc). Anything that doesn't match the code will be flagged in the response rather than silently written — for example, if the SQL side of any lockstep component turns out not to have been updated yet, that will be called out instead of asserted.

No other sections of the knowledge doc or FlowDiagram are touched.
