## Rename "CSM" to "CSM/Self-resolved" on Owner load

Display-only relabel. The owner value stays `CSM` in the database and in filter URLs; only the rendered label changes in the Owner load sections.

### Changes

1. `src/pages/insights/TicketTypesTab.tsx` — Owner load list (around line 207–214): render `o.name === "CSM" ? "CSM/Self-resolved" : o.name` for the visible label.
2. `src/pages/insights/ReportTab.tsx` — Owner load table (around line 369–392) and the highlights string (line 187): same conditional label swap. Drilldown link still passes `owner=CSM`.

### Out of scope

- No DB changes, no filter/dropdown renames elsewhere (Conversations owner filter, memory `mem://team/owners`, sender attribution).
- No edge-function or classification logic changes.