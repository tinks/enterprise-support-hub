## Technical detail

**No schema change, no edge function.** Every signal is a count query against tables that already exist, run from the client with the current user's RLS. v1 is presentation over existing data.

### Signal registry

One file, `src/lib/actionSignals.ts`, exporting an array of signal descriptors: `id`, `label`, `family`, `route`, an async `load()` returning `{ count, oldestAt? , detail? }`, and a short "what it means" line. Adding a signal later is one entry in this array — the page and the badge both render from it, so they can never disagree.

Signals and their sources (all confirmed to exist):

| Signal | Source |
| --- | --- |
| Unattributed customers | `v3_unattributed_groups()` |
| Untriaged tickets | `intercom_tickets_v3` open/snoozed with no `custom_attributes.Severity` — same predicate as `/triage` |
| Open dev escalations | `dev_escalations` where `hub_state` is not closed |
| SLA risk | `useSlaBatch` over open tickets in the current window, counting FR / triage / cadence violations that have no override |
| Integration failures | `integration_health` where `last_status = 'error'` or `consecutive_failures > 0` |
| Stale v3 sync | `intercom_sync_jobs_v3` last success older than its expected cadence |
| Parahelp routing | `parahelp_routing_sync` where `state = 'pending'` |
| Registry drift | `settings.notion_registry_changed_at` newer than `notion_registry_synced_at` |
| Doc approvals | `knowledge_documents` where `pending_content is not null` |
| Channel proposals | `v3_channel_proposals_pending()` |

### Page — `/action-center`

- Cards grouped by family, active ones (count > 0) sorted to the top; a header line reading "N signals watched · M need attention".
- Each card: label, count, oldest-item age where the source has a timestamp, a one-line explanation, and a button to the destination page (pre-filtered where the destination supports a query param, e.g. `/customers?tab=unattributed`).
- Loading state per card, and an explicit error state per card — a signal that fails to load says so rather than rendering `0`. A query error must never look like a clear queue.
- Focus/visibility refetch with the same debounce + 10s guard already used on `/triage`.

### Sidebar badge

A `useActionSignals()` hook runs the same registry once at layout level and shares the result with the page via context, so the badge and the page issue one set of queries between them. The rail shows the count of *signals* needing attention (not the summed item count) as a small accent disc on the Action Center row; nothing renders when everything is clear.

Nav placement: a top-level link above the Reports group — the point of it is to be the first thing you look at.

### Explicitly out of scope for v1

No mute/toggle, no thresholds or age gates (any count > 0 alerts), no Slack notification, no persisted acknowledgement state, no per-user assignment of signals. Those are the natural v2 once we see which cards are noisy in real use.

### Docs

Per the standing convention: `.lovable/project-knowledge.md` via `sync-knowledge-pending` (pending, not live), a `changelog_entries` row, and an Action Center node on the FlowDiagram reading from the existing surfaces.

### Build order

Signal registry + hook → page with cards → sidebar badge → focus refetch → docs pass.
