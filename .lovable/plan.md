

## Auto-assign owner based on Intercom assignment

### Approach

When the webhook receives an assignment event, the payload includes `admin_assignee_id` (the individual admin) and `team_assignee_id` (the team/inbox). We can map known Intercom admin IDs to the app's owner values ("Joel" or "Kristina").

This works for:
1. **Auto-imported conversations** — set `owner` at import time
2. **Already-tracked conversations** — update `owner` when reassigned to a different admin
3. **Slack-originated conversations** — update `owner` in `conversation_mappings` too

### Implementation

**Add admin-to-owner mapping to `settings` table**

Add a new column `admin_owner_map` (text, stores JSON like `{"12345":"Joel","67890":"Kristina"}`). This avoids hardcoding IDs and lets you update mappings from the dashboard later.

*Migration:*
```sql
ALTER TABLE settings ADD COLUMN admin_owner_map text NOT NULL DEFAULT '{}';
```

**Update `supabase/functions/intercom-webhook/index.ts`**

1. Read `admin_owner_map` from settings and parse it as JSON
2. In the assignment handler: extract `admin_assignee_id` from the payload, look it up in the map
3. If a match is found:
   - For **new auto-imports**: include `owner` in the insert
   - For **already-tracked conversations**: update the `owner` field in whichever table holds that `intercom_conversation_id` (`conversation_mappings`, `gmail_conversations`, or `manual_conversations`)
4. Log the mapping result for debugging

```text
Assignment webhook flow (updated):
  → extract admin_assignee_id
  → look up in admin_owner_map → resolve owner name (or null)
  → if new conversation: auto-import with owner set
  → if already tracked: update owner in existing row
```

**Populate the mapping**

After the migration, use the database insert tool to set the initial mapping with Joel's and Kristina's Intercom admin IDs. You'll need to provide these IDs (visible in Intercom admin settings or from webhook payload logs).

**Update `src/pages/FlowDiagram.tsx`**

Add note about auto-owner assignment from Intercom admin mapping.

### Questions

Before proceeding, I need one thing: do you know Joel's and Kristina's Intercom admin IDs? If not, we can log them from the next assignment webhook and populate the mapping afterward. Alternatively, we could match by admin name from the webhook payload (less reliable but requires no ID lookup).

### Files to edit
- `settings` table (migration: add `admin_owner_map` column)
- `supabase/functions/intercom-webhook/index.ts`
- `src/pages/FlowDiagram.tsx`

