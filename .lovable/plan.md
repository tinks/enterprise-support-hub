

## Fix: use admin_assignee_id as fallback for enterprise inbox detection

### Problem
Intercom's routing workflow assigns conversations to individual admins within the enterprise inbox, but the API never sets `team_assignee_id`. Both the webhook and poller only check `team_assignee_id`, so they reject/miss these conversations. The logs confirm: every recent assignment shows `team=null` with a valid `admin_assignee_id` that maps to a known owner (Sam, Joel, Kristina).

### Solution
If `team_assignee_id` is null but `admin_assignee_id` exists in the `admin_owner_map`, treat it as an enterprise inbox assignment. This applies to both the webhook handler and the poller.

### Changes

**File: `supabase/functions/intercom-webhook/index.ts`** (~line 177-201)
- After the API fallback still returns empty `team_assignee_id`, add a third check: if `resolvedOwner` is not null (meaning `admin_assignee_id` is in the owner map), set `isEnterpriseInbox = true`
- Log this fallback path for observability

**File: `supabase/functions/poll-intercom-inbox/index.ts`** (~line 67-80)
- Change the search strategy: instead of only searching by `team_assignee_id`, also search by `admin_assignee_id` for each admin ID in the `admin_owner_map`
- Run a search query per admin ID with `{ field: "admin_assignee_id", operator: "=", value: adminId }` combined with the time filter
- Deduplicate results across searches to avoid processing the same conversation twice

**File: `src/pages/FlowDiagram.tsx`**
- Update relevant nodes to document the admin_assignee_id fallback logic

### Technical detail

```text
Webhook fallback chain:
  1. team_assignee_id matches enterprise inbox? → yes → proceed
  2. API fallback: fetch conversation, check team_assignee_id → match? → proceed
  3. [NEW] admin_assignee_id in admin_owner_map? → yes → proceed
  4. Otherwise → ignore

Poller search strategy (new):
  Search 1: team_assignee_id = enterprise_inbox_id (existing)
  Search 2: admin_assignee_id IN [9520895, 9852095, 9985999] (one query per admin)
  Deduplicate by conversation ID before processing
```

### Files to edit
- `supabase/functions/intercom-webhook/index.ts` — add admin_assignee_id fallback
- `supabase/functions/poll-intercom-inbox/index.ts` — add admin-based search queries
- `src/pages/FlowDiagram.tsx` — update documentation nodes

