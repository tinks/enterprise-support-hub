## Goal

Replace the three-bucket view (Bug / Feature / Other) on the **Ticket types** tab with the full classification taxonomy used everywhere else in the app.

## On "incidents"

We don't have an `incident` classification today. The five options used across `Conversations` and `ConversationDetail` are:

`Issue`, `Configuration`, `Bug`, `FR`, `Question`

Anything with no value falls into a sixth `Unclassified` bucket. Incident.io activity is detected on Slack for status posting but it's never written to `classification` or any ticket-type column, so it can't be charted as a type. If you want incidents as a real bucket, we'd need to add it as a classification option (separate task — let me know).

## Changes — `src/pages/insights/TicketTypesTab.tsx` only

1. **Bucketing rule** (per ticket): use `classification` as the primary type. If null/empty, fall back to `is_bug → "Bug"`, `is_feature_request → "FR"`, else `"Unclassified"`. This keeps legacy rows that have the boolean toggles set but no classification still attributed correctly and matches what users see in the tables.

2. **KPI cards** (top row): swap the 4 cards for a responsive grid of 6 cards — Total + one per bucket — each showing count and % of total. Color-code consistently:
   - Bug → destructive
   - FR → primary
   - Issue → amber/warning
   - Configuration → blue accent
   - Question → muted-foreground
   - Unclassified → border/ghost

3. **Avg time to resolve** card: list TTR per classification (All resolved + 5 buckets + Unclassified), not just Bugs/FR.

4. **Type mix by product area**: stacked bar uses all 6 segments instead of 3, with the same color tokens. Update legend to match.

5. **Owner load**: extend the right-side micro-stats from `Nb · Nfr` to a compact dotted breakdown (e.g. `12 · 4i · 3b · 2fr · 2q · 1c`) using the same color dots as the legend, so you can see each owner's mix at a glance.

6. **CSAT card**: unchanged.

## Out of scope

- No DB or edge-function changes.
- No new classification options (e.g. `Incident`) — flagged above as a follow-up if you want it.
- Other tabs (Customers, Trends, Channels, Topics) untouched.

## Files

- `src/pages/insights/TicketTypesTab.tsx` (rewrite the stats memo + 4 sections above)
- `.lovable/project-knowledge.md` (note that Insights → Ticket types now uses the full classification taxonomy with boolean fallback)
