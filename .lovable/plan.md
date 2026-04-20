

## Check: are we importing all Team Inbox Enterprise tickets?

### Short answer
**Mostly yes, but with gaps.** We import on three triggers, each with the strict `team_assignee_id == enterpriseInboxId` guard. But coverage has holes.

### Current import paths (all guarded by enterprise inbox check)

1. **`intercom-webhook`** — fires on assignment events. Imports when a ticket gets assigned to the enterprise inbox in real time.
2. **`poll-intercom-inbox`** — runs on a schedule, searches Intercom for:
   - `team_assignee_id = enterpriseInboxId` updated since `last_polled_intercom_at`
   - Plus per-admin searches (Joel/Kristina, excluding Sam) — but each result is still verified against the inbox before import.
3. **Manual import** via Import tab (single ticket or bulk CSV).

### Gaps in coverage

- **A. Tickets that landed in the inbox but were never updated after `last_polled_intercom_at`.** The poller filters by `updated_at > since`. If a ticket was assigned to the enterprise inbox before the cursor and has had zero activity since, it won't appear in search results and won't get imported.
- **B. Tickets created in the inbox without an `assignment` webhook event.** E.g., if a ticket is created directly in the enterprise inbox via Intercom UI without triggering a topic we subscribe to, the webhook path misses it. The poller catches these on the next run only if their `updated_at` is recent.
- **C. Search pagination cap.** Poller stops at `MAX_PAGES_PER_QUERY = 3` (150 results per query). On a high-volume catch-up run, anything beyond page 3 is silently dropped.
- **D. Webhook subscription gaps.** If the Intercom app isn't subscribed to `conversation.admin.assigned` + `conversation.admin.open.assigned` + `conversation.user.created`, real-time imports miss those event types.

### Verification I'd do before changing code

1. Query Intercom directly for `team_assignee_id = <enterpriseInboxId>` with no time filter, count total open + closed tickets.
2. Compare to `SELECT COUNT(*) FROM manual_conversations WHERE source='intercom'`.
3. The delta = tickets we're missing.

### Proposed plan (if a delta exists)

1. **Add a "backfill enterprise inbox" edge function** — paginates through ALL Intercom tickets with `team_assignee_id = enterpriseInboxId` (no time bound, no page cap), imports anything not already in `manual_conversations` / `gmail_conversations` / `conversation_mappings`. Batched + offset-based to avoid the 150s timeout, like `cleanup-bad-intercom-imports`.
2. **Trigger button** on Settings: "Backfill all enterprise inbox tickets".
3. **Raise `MAX_PAGES_PER_QUERY`** in the poller from 3 → 10 (or remove cap on the team-assignee query, since that one is bounded by `last_polled_intercom_at`).
4. **Update Flow diagram** with the new backfill path.

### Files
- New: `supabase/functions/backfill-enterprise-inbox/index.ts`
- Edit: `supabase/functions/poll-intercom-inbox/index.ts` (raise/remove page cap on team-assignee query)
- Edit: `src/pages/Index.tsx` (add backfill button with batch loop)
- Edit: `supabase/config.toml` (register new function)
- Edit: `src/pages/FlowDiagram.tsx` (document backfill path)

### Recommended next step
Approve so I can switch to default mode and run the Intercom-vs-DB count comparison first — that confirms whether this is theoretical or there's a real delta to backfill.

