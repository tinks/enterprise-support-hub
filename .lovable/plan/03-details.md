## Per-view result

| View | Columns after the change |
| --- | --- |
| Inbox v3 | ID · Subject · Contact · Customer · Owner · Product area · Classification · State · Lifecycle · RSA · CSAT · Resolve · Age |
| Prospects | ID · Subject · Contact · Customer · Owner · Domain · Product area · Status · Age (created) |
| Triage | ID · Subject · Contact · Customer · Owner · Anchor · Elapsed (wall) · Age (business, banded pill) |
| Escalations | ID · Subject · Contact · Customer · Owner · Type · Linear · Hub state · Note · Age |
| Customers evidence lists | ID · Subject · Customer (current attribution) · Age (created) |

Sorting, filters, and each view's own population logic are untouched — only presentation moves.

## Build order

**Wave 1 — template + the four v3 pages.** Build `src/components/issues/IssueTable.tsx` and `IssueDetailSheet.tsx`, then convert Inbox v3, Prospects, Triage, and Escalations onto them. Each conversion is verified against the current page by count and by spot-checking a row before moving on.

**Wave 2 — the remaining ticket lists.** SLA Workbench violations table, Customers evidence lists, and the ticket table in the Customer report. These are structurally different (violation rows carry a metric and an excuse action; evidence lists are nested and dense), so they adopt the identity block and the ID chip but keep their own trailing action columns. Kept separate so wave 1 can land and be judged first.

The Dashboards (SLA dashboard, Owner dashboard) are aggregate scorecards, not issue lists — out of scope; they get no table changes.

## Technical notes

- `IssueTable<T>` takes `rows`, a `columns: IssueColumn<T>[]` array, `getId`, an optional `rowClassName` (Triage banding, Escalation state tint), `onRowClick`, plus loading/empty slots. Column widths and `text-left` alignment come from the shared definition so the existing 140px/text-left convention holds everywhere without per-page repetition.
- Shared identity columns (`idColumn`, `subjectColumn`, `contactColumn`, `customerColumn`, `ownerColumn`, `ageColumn`) are exported factories so a view opts in rather than re-declaring markup.
- The single `intercomUrl()` helper (currently duplicated in six files) moves to `src/lib/intercom.ts`; the ID chip lives in the template and calls `e.stopPropagation()`.
- Customer label resolution (`v3_customer_accounts` → label map) is duplicated per page today; it moves into a `useCustomerLabels()` hook the template's customer column uses.
- `IssueDetailSheet` renders the common metadata block (subject, IDs, contact, customer, owner, dates, tags, Intercom link) and accepts `extra` children for view-specific content.
- No migration, no edge-function change, no query change. Presentation-only, so per project convention this pass skips the knowledge/FlowDiagram/changelog update — except for one Flow/knowledge note recording the shared component, done as a separate docs turn if you want it.
- Verification: `tsgo --noEmit`, full vitest, and a Playwright pass over `/inbox-v3`, `/prospects`, `/triage`, `/escalations` at 2504px wide, comparing row counts before and after.
