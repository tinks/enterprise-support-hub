## Technical detail

**New module** — `src/lib/resolutionAnatomy.ts`

```ts
computeAnatomy(raw, opts) -> {
  ourClockS, theirClockS, driftS, totalS,          // wall clock
  ourClockBizS, theirClockBizS,                    // Berlin business hours
  longestGap: { seconds, owedBy, afterPartId },
  replyCount, adminReplyCount, customerReplyCount,
  closedWithoutCustomerConfirm: boolean,
  timeToFirstCloseS: number | null
}
```

Built entirely on existing exports from `src/lib/slaMetrics.ts` — `extractTimeline`, `classifyActor`, `businessHoursBetween`, `DEFAULT_BUSINESS_HOURS`. `shared_inbox` counts customer-side, matching the B6 decision already in the engine. No edits to `slaMetrics.ts` beyond none; if a helper needs exporting it will be an export-only change.

Unit tests cover: clean two-turn ticket, customer-silence ticket, closed-with-no-customer-reply, reopened ticket, ticket with no timeline (returns nulls, never zeros — an absent measurement must not read as "instant").

**New page** — `src/pages/ResolutionAnatomy.tsx`, route `/resolution-anatomy`, added to the Reports group in `src/components/AppLayout.tsx`. Uses `IssueTable` so sortable headers come for free.

**Data path** — one paged query over `intercom_tickets_v3` for finalized tickets in the window, selecting `raw_payload` only for rows over the threshold (the payloads are large; the rollup counts come from scalar columns). Anatomy is computed in the browser, same as the SLA surfaces do today. If that proves too heavy at 12-month windows we move it to a precomputed column later — not in this step.

**No migration.** Nothing is persisted in this step. Every number is derived on read, so there is no new source of truth to keep in sync and nothing to backfill.

**Verification before this is called done**
- The three buckets plus drift must sum to the ticket's wall clock for every sampled ticket; a reconciliation check runs over a sample and reports any row that fails.
- Hand-check 5 long runners against their Intercom threads and confirm the split matches what the thread actually shows.
- Anything not checked gets stated as UNVERIFIED.

**Documentation** — `.lovable/project-knowledge.md` via `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node for the new page.
