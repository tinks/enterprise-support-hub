## Technical detail

No schema change; every field needed is already on `intercom_tickets_v3`.

**`src/pages/Triage.tsx`**

- Add `admin_assignee_id` to the select list (`owner` is already fetched).
- Add a `mode` state (`needs_severity` | `unassigned` | `either`) rendered as a small segmented control next to the existing filters, kept in the URL as `?mode=` so the Action Center can deep-link.
- Predicates: `hasSeverity(custom_attributes)` (existing) and a new `isUnassigned(row)` = `!row.admin_assignee_id?.trim() || !row.owner?.trim()`.
- The `untriaged` memo filters by mode instead of only severity; band computation stays but the band pill and the band-count chips only render in `needs_severity`.
- Row tint (`rowClassName`) is neutral outside `needs_severity`.
- New "Missing" column, shown in `unassigned` / `either`, reading `no Intercom assignee`, `assignee not mapped`, or `no severity`.
- Header copy and the info callout become mode-aware; the "Severity writes enabled" badge and the propose-severity batch button stay scoped to the severity modes.
- Empty states per mode: "Nothing awaiting triage." / "Everything is assigned."

**`src/lib/actionSignals.ts`**

- New `unassigned_tickets` signal: open + reopened rows, exclusion fields selected as the `first_response_risk` signal already does, `isSlaExcluded` applied, then the `isUnassigned` predicate. Returns count plus Intercom IDs, `href: /triage?mode=unassigned`.
- Export `isUnassigned` from a shared spot (`src/lib/triageQueues.ts`) so page and signal cannot drift, matching the `slaExclusions.ts` precedent.

**`src/pages/ActionCenter.tsx`** — render the new card with its meaning line, including that excluded tickets (duplicate, fyi, prospect, non-enterprise, test) are not counted.

**Paperwork** — `src/pages/FlowDiagram.tsx` node for the Triage modes and the new signal, `.lovable/project-knowledge.md` staged via `sync-knowledge-pending`, and a `changelog_entries` row.

**Verification** — SQL counts per mode before and after (today: 0 needs-severity, 1 unassigned, 1 either), plus confirming the Action Center count matches the queue after exclusions, at a wide viewport.
