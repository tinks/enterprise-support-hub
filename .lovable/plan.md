

## Update owner for all direct message conversations

### Problem
The previous "assign CSM to direct messages" update only applied to `manual_conversations` where `source = 'slack_dm'` (2 rows). But there are 12 additional DM conversations in `conversation_mappings` where `slack_channel_id` starts with `D` (Slack DM channels) that were missed. These show as "Direct message" in the UI with no owner.

### Solution

**Database migration** — update the 12 unassigned DM rows:
```sql
UPDATE conversation_mappings
SET owner = 'CSM'
WHERE slack_channel_id LIKE 'D%'
  AND (owner IS NULL OR owner = '');
```

This is a one-line migration. No code changes needed.

### Files to edit
- Database migration only

