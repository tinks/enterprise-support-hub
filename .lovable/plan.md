## (HELD) Add Slack-bot KPI section to Analytics v3

Status: **on hold** — pick back up when ready.

### Goal

Surface Ask Lovable Slack-bot ticket volume on the v3 Analytics page so it matches the Monthly Support Report's Slack column.

### KPI cards (4)

Received · Resolved · Escalated to human · Bot success rate (= bot-resolved / received), all scoped to the v3 page's date range/preset. Secondary line: median/avg resolution + owner mix.

### Bot-handled identifier (REVISED 2026-06-29)

**Use `intercom_tickets_v3.admin_assignee_id = '9520895'` (Sam's Intercom admin ID), joined to Slack-origin tickets via `conversation_mappings.intercom_conversation_id`.**

Why this changed: `conversation_mappings.owner` is set at Slack-intake time and is **never updated** when a human takes the ticket over in Intercom. June test: the Slack-side heuristic (`cm.owner IN (NULL, 'Sam')` AND `status='resolved'`) returned 24 tickets, but joining to v3 showed only **13** were truly Sam-handled — the other 11 had been picked up in Intercom by Tine (7), Matt (2), Kristina (1), or an unknown admin 7987702 (1). `intercom_tickets_v3.admin_assignee_id` is refreshed every sync, so it's the source of truth.

Do NOT use:
- `conversation_mappings.owner` (stale after Intercom handoff)
- "resolved without `intercom_conversation_id`" (every Slack thread mirrors to Intercom, so this is always 0)

### Query shape

```sql
SELECT cm.*, v3.admin_assignee_id, v3.owner AS intercom_owner
FROM conversation_mappings cm
JOIN intercom_tickets_v3 v3 ON v3.intercom_conversation_id = cm.intercom_conversation_id
WHERE cm.created_at >= :from AND cm.created_at < :to
  AND cm.is_test = false
  AND cm.status <> 'cancelled'
-- bot-resolved = status='resolved' AND v3.admin_assignee_id = '9520895'
-- escalated   = v3.admin_assignee_id IS NOT NULL AND v3.admin_assignee_id <> '9520895'
```

Sam's admin ID `9520895` is already canonical (see `mem://team/owners`).

### Scope guardrails

- Single client-side query, same pattern as existing v3 cards.
- No changes to `intercom_tickets_v3`, sync functions, v3 crons, Monthly Support Report, or existing v3 KPIs.
- Out of scope: merging Slack counts into Total/CSAT/Resolve KPIs; Gmail column; new edge functions.

### Standing-rule maintenance (when shipped)

Update `.lovable/project-knowledge.md`, the Flow page node, and `changelog_entries`.
