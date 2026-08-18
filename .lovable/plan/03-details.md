## Phase 1 — cache and drift (no behaviour change)

**Migration.** `public.intercom_field_options`:

| column | notes |
| --- | --- |
| `attr_key` | Intercom attribute name, e.g. `Affected Product Area`, `Ticket type` |
| `option_value` | one allowed value |
| `sort_order` | position as Intercom returns it |
| `active` | false when Intercom stops returning it (never deleted) |
| `first_seen_at` / `last_seen_at` | drift evidence |

Primary key `(attr_key, option_value)`. Grants: `select` to `authenticated`, `all` to `service_role`. RLS on; read for authenticated, writes only via the sync function's service role.

**Edge function `sync-intercom-fields`.** `GET /data_attributes?model=conversation` at `Intercom-Version: 2.13`, filter to the attribute names the Hub writes, upsert options, mark missing ones `active = false`. Reports through the existing `integration-health` helper so a failed fetch shows up where every other integration failure does. Scheduled daily via `pg_cron`, plus a manual "Refresh from Intercom" button in Settings. `verify_jwt = false`, consistent with the other cron functions (batch 5 territory, deliberately untouched).

**Drift surfacing.** Settings gains a small panel per attribute: cached options, `last_seen_at`, and any value present in `settings.product_areas` or the pinned ticket-type array that Intercom does not return — plus the reverse. An Action Center signal fires when either side has an entry the other doesn't, or when `last_seen_at` is older than 48h. Nothing is auto-corrected.

Phase 1 changes no validation. `settings.product_areas` and the pinned ticket-type list stay authoritative.

## Phase 2 — validation cutover (per field)

Only after Phase 1 has run clean and the cached set matches the hand-maintained set for both fields.

- `esh-write-action` resolves allowed values as: cache (`active = true`) if the attribute has a non-empty, fresh cache, else the pinned list. Fallback path logs an `esh_ticket_actions` row noting it used the fallback, so silent degradation is impossible.
- Refusal message names the source: "not a valid Ticket type — Intercom offers X, Y, Z (synced 3h ago)".
- `TicketFieldWriteControls.tsx` reads its dropdown options from the cache with the same fallback, so the UI can never offer a value the function will refuse.
- Product area cutover follows ticket type, one field per pass. `settings.product_areas` is not dropped — the read-only surfaces (`Insights`, `Conversations`, `auto-categorize-product-area`) keep using it until a later, separate pass retires it. Two sources coexisting is deliberate and time-boxed, not an oversight.

## Out of scope

Owner / `admin_owner_map`. Severity (fixed 1–4, not an Intercom list). Retiring `settings.product_areas` from read surfaces. Any change to what the sync functions own.

## Verification before Phase 2 starts

1. Cache populated for both attributes; row counts and values printed and compared to the hand-maintained lists.
2. Drift detected on purpose: add a throwaway value to `settings.product_areas`, confirm the panel and Action Center signal flag it, then remove it.
3. Fetch failure path: confirm `integration_health` records the failure and the cache is left untouched rather than emptied.
4. Stale cache: confirm the 48h staleness signal fires (by backdating `last_seen_at` on a test row).

Each phase gets its own `changelog_entries` row, `.lovable/project-knowledge.md` update via `sync-knowledge-pending`, and FlowDiagram node — per phase, not batched.
