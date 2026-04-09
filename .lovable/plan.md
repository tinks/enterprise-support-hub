

## Populate the Intercom admin-to-owner mapping

### Problem
The webhook already resolves owners from `admin_owner_map` in the `settings` table, but the map is currently empty (`{}`). Now we have the IDs.

### Solution

**Database migration** — set the `admin_owner_map` JSON:
```sql
UPDATE settings
SET admin_owner_map = '{"9985999":"Kristina","9852095":"Joel","9520895":"Sam"}'
WHERE id = (SELECT id FROM settings LIMIT 1);
```

This includes all three known admin IDs:
- **9985999** → Kristina
- **9852095** → Joel  
- **9520895** → Sam (the bot/AI agent)

No code changes needed — the webhook already reads this map and applies it on every assignment event.

### UI enhancement
Add an "Admin mapping" section to the Settings page (`src/pages/Index.tsx`) so you can edit this mapping from the UI instead of needing a migration next time.

### Files to edit
- Database migration — populate `admin_owner_map`
- `src/pages/Index.tsx` — add admin mapping editor
- `src/pages/FlowDiagram.tsx` — note that admin mapping is now active

