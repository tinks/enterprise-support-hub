

## Auto-update owner for linked Gmail conversations on Intercom assignment

### Problem
Gmail conversation `5af5d793-6209-45c8-baf7-191a9f2e2ea1` has no `intercom_conversation_id`, so when Kristina is assigned in Intercom, the webhook can't find and update the Gmail row's owner. The auto-owner logic only searches `conversation_mappings` and `manual_conversations` — it never checks `gmail_conversations`.

### Solution

**1. `supabase/functions/intercom-webhook/index.ts`** — Add `gmail_conversations` lookup

In the assignment handler section, after checking `conversation_mappings` and `manual_conversations` for the Intercom conversation ID, also check `gmail_conversations`. If found, update the `owner` field using the same `admin_owner_map` resolution.

**2. Immediate fix** — Database migration to set the owner on this specific row:
```sql
UPDATE gmail_conversations
SET owner = 'Kristina'
WHERE id = '5af5d793-6209-45c8-baf7-191a9f2e2ea1';
```

**3. `src/pages/FlowDiagram.tsx`** — Document that auto-owner now covers all three tables.

### Files to edit
- `supabase/functions/intercom-webhook/index.ts` — add `gmail_conversations` to owner update lookup
- Database migration — fix this specific row
- `src/pages/FlowDiagram.tsx` — update flow notes

