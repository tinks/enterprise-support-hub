# Reconcile Source performance counts with Total tickets

## Why 85 + 60 + 200 ≠ 334

- **Total (334)** is local DB only: Slack rows + Gmail rows + manual imports.
- **Slack 85** and **Gmail 60** are local DB by origin.
- **Intercom 200** is fetched live from the Intercom API, NOT from our DB. It includes:
  - Slack-escalated conversations (already counted in Slack = 85 → double count)
  - Intercom conversations that were never imported as `manual_conversations` locally

That's where the +11 comes from.

## Fix

Use the **local DB** for the Intercom count column so all four buckets share the same population as Total. Keep the live Intercom API only for the response-time / handling-time medians which we can't compute locally.

### Files

1. `src/pages/insights/sourceBucket.ts` (new) — single source of truth:
   ```ts
   export function sourceBucketOf(t: NormalizedTicket): "slack" | "gmail" | "intercom" | "other" {
     if (t.route_source === "slack") return "slack";
     if (t.route_source === "gmail") return "gmail";
     if (t.display_source === "intercom") return "intercom";
     return "other";
   }
   ```

2. `src/pages/insights/ReportTab.tsx` — drop the inline `sourceBucketOf` and import from the new util.

3. `src/pages/insights/MonthStatsCards.tsx`:
   - Add `computeIntercomStats(tickets)` filtering by `sourceBucketOf(t) === "intercom"` → local Received / Resolved / Open / median resolution.
   - Replace the **Received**, **Resolved**, **Open**, **Median resolution / time to close** Intercom cells with local values.
   - Keep `intercomCell(...)` only for `Median first response`, `Median response time`, `Median handling time` (live Intercom API).
   - Update the footer line to: "Response/handling times from Intercom API ({n} live conversations)" and clarify counts are local.

After this change Slack + Gmail + Intercom + Other in both Source mix and Source performance Received row equal Total.

No backend or schema changes.
