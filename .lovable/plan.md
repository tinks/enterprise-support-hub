## Make April's 78 "Uncategorized" actionable

### 1. Confirm what's in there
After thread/intercom-id dedup, April's "Uncategorized" bucket is roughly:
- **56 manual conversations** — Intercom-imported tickets where `product_area` was never set.
- **25 Gmail threads**, of which **24 are internal `@lovable.dev` outbound replies** showing up as standalone threads (likely missed thread-dedup with the original inbound), and 1 real external (`accounts@1password.com`).

So most of the bar is two things: unassigned Intercom tickets, plus internal-only Gmail threads that probably shouldn't count at all.

### 2. Add an "Uncategorized tickets" panel to the Report tab
Below the existing "By product area" chart, render a collapsible card titled **"Uncategorized — N tickets"**. When opened it lists every ticket whose `product_area` is empty in the current month, with columns:

```text
Source | Subject | Customer/Sender | Created | [Product area ▾] | [Open]
```

- Source badge (Slack / Gmail / Intercom / Manual).
- Subject links to `/conversations/{id}?source={route_source}`.
- Per-row **Product area Select** prefilled with empty, options pulled from `settings.product_areas` (same list used in `ProductAreasCard`) plus "Other".
- Selecting a value writes immediately to the right table:
  - `route_source = "slack"` → `conversation_mappings.product_area`
  - `route_source = "gmail"` → `gmail_conversations.product_area` (propagate to all rows sharing the same `gmail_thread_id`, matching existing Gmail Thread Sync rule)
  - `route_source = "manual"` → `manual_conversations.product_area`
- Write an entry to `conversation_audit_logs` (`action: "product_area_set"`, old/new values) so it shows up in history, matching the existing audit pattern.
- After save, the row visually updates (strike-through or fades) and the cached refresh count goes down — the existing **Refresh** button re-pulls totals.

### 3. Bulk apply (optional convenience)
At the top of the panel:
- Checkbox column + a small toolbar: **"Apply to selected: [Product area ▾] [Apply]"**.
- "Select all visible" toggle.

### 4. Filter helpers
Two small filter chips above the list:
- **Hide internal lovable.dev senders** (default ON) — hides the 24 internal Gmail replies so the list reflects real customer tickets needing triage.
- **Source: All / Slack / Gmail / Manual**.

### 5. Out of scope (can be follow-ups)
- Fixing the underlying Gmail thread-dedup bug that produces standalone internal-only threads.
- Excluding internal lovable.dev senders from the "By product area" chart entirely (today they're only excluded from "Top accounts").

### Technical notes
- New component: `src/pages/insights/UncategorizedPanel.tsx`, mounted from `ReportTab.tsx` right after the existing product-area block.
- Re-uses `monthData.tickets` (already filtered to the selected month) — filter for `!t.product_area`. No new data fetching for the list itself.
- Loads product-area options once via `supabase.from("settings").select("product_areas").maybeSingle()`.
- Updates are direct `supabase.from(<table>).update({ product_area }).eq("id", ticketId)` calls; for Gmail also `.eq("gmail_thread_id", threadId)` when present.
- Uses optimistic update + revert-on-error, matching existing pattern in `mem://logic/optimistic-updates-handling`.
