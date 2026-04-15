

## Fix: Comprehensive search in conversations inbox

### Problems identified
1. **Partial UUID search broken** — Only full UUIDs (36 chars) trigger `id.eq.` matching. Searching `312d14c3` finds nothing because the regex requires a complete UUID pattern.
2. **Missing searchable fields** — Several visible/important columns are not included in search:
   - `slack_user_name` and `owner` on conversation_mappings
   - `owner` and `classification` on gmail_conversations
   - `owner`, `classification`, and `link` on manual_conversations
3. **No message content search for Slack** — Manual conversations search `manual_messages.message_text`, but there's no equivalent for `original_message_text` partial matches on Slack (already done) or message thread content.

### Solution
Single file edit to `src/pages/Conversations.tsx`, lines 750-796 (the `doSearch` function):

1. **Replace UUID-only `id.eq.` with `id.ilike.` always** — Remove the `isUuid` regex check entirely. Use `id.ilike.%q%` in every `.or()` filter, which allows partial UUID matching (PostgREST casts UUID to text for `ilike`).

2. **Add missing fields to each table's `.or()` filter:**
   - **conversation_mappings**: add `slack_user_name.ilike.`, `owner.ilike.`, `classification.ilike.`
   - **gmail_conversations**: add `owner.ilike.`, `classification.ilike.`
   - **manual_conversations**: add `owner.ilike.`, `classification.ilike.`, `link.ilike.`

3. **Result**: Every visible column plus the ID is now searchable. Users can search by partial UUID, owner name, classification label, contact name, email, subject, message text, or Intercom ID.

### Technical detail

The `.or()` filter strings become (simplified):

```text
conversation_mappings:
  id.ilike.%q%, original_message_text.ilike.%q%, status.ilike.%q%,
  product_area.ilike.%q%, slack_user_id.ilike.%q%, slack_channel_id.ilike.%q%,
  intercom_conversation_id.ilike.%q%, slack_user_name.ilike.%q%,
  owner.ilike.%q%, classification.ilike.%q%

gmail_conversations:
  id.ilike.%q%, from_email.ilike.%q%, from_name.ilike.%q%, subject.ilike.%q%,
  snippet.ilike.%q%, status.ilike.%q%, product_area.ilike.%q%,
  intercom_conversation_id.ilike.%q%, owner.ilike.%q%, classification.ilike.%q%

manual_conversations:
  id.ilike.%q%, contact_name.ilike.%q%, subject.ilike.%q%, source.ilike.%q%,
  status.ilike.%q%, product_area.ilike.%q%, intercom_conversation_id.ilike.%q%,
  owner.ilike.%q%, classification.ilike.%q%, link.ilike.%q%
```

### Files to edit
- `src/pages/Conversations.tsx` — rewrite the `doSearch` filter block (lines 750-796)

