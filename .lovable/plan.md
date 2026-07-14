## Docs-only update — Track A (Customer Resolution)

Application logic will NOT be changed. Only:
1. `.lovable/project-knowledge.md` — rewrite the v3 customer section
2. `src/pages/FlowDiagram.tsx` — add a Customers-resolution node
3. Stage new knowledge content as `pending_content` via `sync-knowledge-pending` (per standing rule)

Before writing, reconcile the user-supplied source-of-truth against actual code/migrations (functions, tables, columns, RPCs) and correct any drift.

---

### 1. project-knowledge.md

Replace the existing `## v3 Customer slices (shipped)` block (lines ~825–832) with a new `## v3 Customer resolution (Track A)` section covering:

- **Purpose** — attribute each `intercom_tickets_v3` ticket to a known customer; Intercom stays read-only.
- **Data model** — list actual tables verified against the schema:
  - `v3_customer_accounts` (label, domains[], aliases[], tier, csm_owner, status, notes) — admin-only writes
  - `v3_channel_account_map` (slack_channel_id → account_key)
  - `v3_internal_channels` (exclusion list, seeded with `C0AJ1KPQ084`)
  - `v3_workspace_customer_map` (workspace_id → account_key, tier)
  - `v3_ticket_attributes` + `intercom_tickets_v3.custom_attributes` jsonb mirror
  - `v3_coverage_snapshots` (daily snapshot)
  - `v3_channel_account_proposals` (pending suggestions)
  - `v3_personal_email_domains` (consumer providers allowlist)
  - New `intercom_tickets_v3` columns: `customer_resolution_method`, `customer_confidence`, `custom_attributes`, `slack_channel_id_detected`, `workspace_id_detected`, `project_uuid_detected` (plus existing `customer_key/kind/source/override_*`).
- **Signal extraction (sync-time)** — `_shared/v3-signals.ts` (slack channel id from bot `slack-url-*` notes only; workspace_id regex; project uuid) and `_shared/v3-attributes.ts` (custom_attributes flatten). Runs in `sync-v3-closed`, `sync-v3-open`, `_shared/v3-finalize.ts`. Backfills: `backfill-v3-signals`, `backfill-v3-ticket-attributes`.
- **Resolver — lockstep contract** across three objects: SQL `v3_derive_customer`, trigger `intercom_tickets_v3_apply_customer`, propagate triggers (`v3_customer_accounts_propagate`, `v3_channel_account_map_propagate`, `v3_internal_channels_propagate`, `v3_workspace_customer_map_propagate`), and Deno helper `_shared/v3-customer.ts`. Resolution order: override → slack_channel → domain (excluding lovable.dev + personal) → workspace_id (medium) → `unattributed`.
- **Verified coverage** — "attributed" only counts tickets resolved to a registry account; orphan overrides are surfaced separately. `v3_coverage_current()` + daily `v3_capture_coverage_snapshot()` cron.
- **UI `/customers`** — four tabs (Coverage / Unattributed / Channels / Registry), evidence drill-down via `v3_tickets_for_channel` and `v3_tickets_for_override_key`. Per-ticket override open to authenticated users; structural edits admin-only.
- **Key RPCs** — full list.
- **Design principles** — surface loudly, human signals advisory, prospects are real accounts (tag-driven).

Reconciliation pass while writing: verify each named table/column/function exists (schema table already in context; cross-check `v3_derive_customer`, propagate triggers, RPCs from the `<db-functions>` block) and correct anything that has drifted (e.g. confirm cron time `06:00` vs snapshot function; verify exclusion-list channel id).

### 2. FlowDiagram.tsx

Add a new node `customer-resolution` in the utility/reporting cluster (near `inbox-v3-*` nodes), no new edges required (it's a cross-cutting attribution layer):

```text
Customer resolution (Track A)
  route: /customers, icon: Users
  desc: Attribute intercom_tickets_v3 to registry customer accounts.
  details:
    - Resolver order: override → slack_channel → domain → workspace_id → unattributed
    - Lockstep: v3_derive_customer + apply trigger + propagate triggers + _shared/v3-customer.ts
    - Signals extracted at sync (v3-signals.ts) into *_detected columns
    - Daily v3_capture_coverage_snapshot → v3_coverage_snapshots
    - UI tabs: Coverage / Unattributed / Channels / Registry with Intercom evidence drill-down
    - Structural edits admin-only; per-ticket override open to all authenticated users
```

### 3. Stage for review

After editing `project-knowledge.md`, invoke `sync-knowledge-pending` with the full new markdown + short summary so `/knowledge` shows the diff for approval (per `.lovable/memory/preferences/knowledge-doc-pending-review.md`).

### Out of scope

- No changes to resolver SQL, triggers, edge functions, or `Customers.tsx`.
- No new migrations.
- No touch to legacy tables or `/insights`.
