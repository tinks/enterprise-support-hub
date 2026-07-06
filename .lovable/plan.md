## SLA Test page — prototype

A standalone prototype at `/sla-test` that computes SLA metrics from `intercom_tickets_v3` for `owner = 'Matt'`, `lifecycle_status IN ('finalized','reopened_after_finalize')`. All math runs client-side off `raw_payload.conversation_parts` — no schema changes, no edge functions, no v3 sync changes.

### Metrics per ticket

Extract public parts from `raw_payload.conversation_parts.conversation_parts[]` (filter out `part_type = 'assignment' | 'note' | 'note_and_reopen'`; keep `comment`, `close`, `open`, `assign_and_reopen`, etc. — anything with a visible message or state change). Include the initial `source` message as the first user event.

1. **Time to first admin reply** — Intercom's `statistics.time_to_admin_reply` (fallback: first admin part - created_at).
2. **Raw time to resolve** — `statistics.time_to_last_close` (what today's v3 uses).
3. **Sum of user→admin response gaps** — walk parts in order; for each transition from `author.type = 'user'` to `author.type = 'admin'|'bot'`, add `(admin_ts - user_ts)`. Excludes the trailing gap-to-close when the last event isn't an admin reply.
4. **Business-hours adjusted handling time** — same as #3, but each gap is clipped to the Mon–Fri 09:00–23:59 UTC window (subtract weekend hours and 00:00–09:00 UTC weekday hours from each interval).

### Aggregate KPIs (top strip)

For each of the 4 metrics: **Average**, **Median**, **P90**, computed across Matt's finalized tickets. Small cards, same visual language as `/analytics-v3`.

### Per-ticket table (below KPIs)

Columns: Closed date · Subject (linked to Intercom) · Contact · First reply · Raw resolve · Response-gap sum · Business-hours adjusted · # parts. Sortable by any metric. Durations formatted as `2d 4h 12m` (reuse the formatter pattern from AnalyticsV3).

### Files

- `src/pages/SlaTest.tsx` — page: fetches Matt's finalized rows (id, subject, contact_name, contact_email, intercom_conversation_id, intercom_created_at, intercom_closed_at, statistics fields, raw_payload), runs metric calc in a `useMemo`, renders KPI strip + table.
- `src/lib/slaMetrics.ts` — pure functions: `extractParts(raw)`, `sumUserToAdminGaps(parts)`, `businessHoursGap(startSec, endSec)` (Mon–Fri 09:00–23:59 UTC clipper), `computeTicketSla(row)`, and `aggregate(values)` returning `{avg, median, p90}`. Unit-testable.
- `src/App.tsx` — add `<Route path="/sla-test" element={<ProtectedRoute><SlaTest /></ProtectedRoute>} />`.
- `src/components/AppLayout.tsx` — add sidebar item "SLA test" (alphabetical placement, beaker/gauge icon).

### Out of scope

- No changes to v3 sync, tables, or edge functions.
- No new columns persisted — all metrics computed on the fly from `raw_payload`.
- No filters beyond Matt-only for now; date range / owner selector can come after we validate the numbers.
