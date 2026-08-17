# Prospects page (enterprise-prospect tickets)

A new read-only ticket view listing every ticket carrying the `enterprise-prospect` Intercom tag, reachable from the Tools flyout.

## What it shows

Source: `intercom_tickets_v3` rows where `tags` contains `enterprise-prospect` (currently 21 rows: 19 finalized, 2 open). A tag toggle also lets you view `enterprise-prospect-personal-acct` (5 rows) or both, since they are the two prospect dispositions.

Columns, matching the Inbox v3 table conventions:
- Subject (+ Intercom deep link)
- Contact name / email / domain
- Customer (resolved account label — most prospects resolve to `prospect_unmapped`)
- Owner
- Product area / classification
- State + lifecycle status
- Created / closed dates
- Tags

## Search and filters

Same controls as the other ticket views:
- Free-text search across subject, contact name, email, domain, conversation ID
- Owner dropdown
- Product area dropdown
- Lifecycle: all / open / finalized
- Tag scope: enterprise-prospect / personal-acct / both
- CSV export of the filtered set (matching the export pattern used elsewhere)

Clicking a row opens the same detail sheet style used in Inbox v3 (read-only: metadata + Intercom link), no editing or override controls.

## Honesty note on the page

Tags only populate on a full fetch, which runs when a ticket closes. Open tickets are tag-blind, so the page carries the same caveat banner wording already used on the Customers → Unattributed queue: open tickets missing tags will not appear here until they close.

## Technical notes

- New `src/pages/Prospects.tsx`, route `/prospects` in `src/App.tsx` (wrapped in `ProtectedRoute`).
- Nav: add "Prospects" to the Tools group in `src/components/AppLayout.tsx`.
- Query: `.contains("tags", [tag])` on `intercom_tickets_v3`, client-side filtering for the rest (volume is tiny).
- No migrations, no edge functions, no changes to the resolver or SLA logic.
- Docs pass (FlowDiagram + project-knowledge via `sync-knowledge-pending` + changelog row) kept as a separate turn per convention.
