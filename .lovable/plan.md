

## Add "Mark as Test" Toggle and Message Preview to Conversations Table

### What Changes

1. **Message preview column** — Show the first ~60 characters of `original_message_text` in a new "Message" column so each conversation is easier to identify at a glance.

2. **Toggle test button** — Add a small button per row to toggle the `is_test` field on `conversation_mappings`. Clicking it flips `is_test` between `true` and `false` and updates the row in the database. A visual indicator (e.g., a "Test" badge or muted row styling) shows which conversations are marked as test.

### Technical Details

**File: `src/pages/Conversations.tsx`**

1. Update the `ConversationMapping` interface to include `is_test: boolean` and `original_message_text: string`
2. Add a "Message" column header after "Sent by"
3. Render a truncated preview of `original_message_text` (first 60 chars + ellipsis) in each row
4. Add a "Test" column with a toggle button:
   - Shows current state (e.g., `<Badge>Test</Badge>` or a `FlaskConical` icon button)
   - On click, calls `supabase.from("conversation_mappings").update({ is_test: !m.is_test }).eq("id", m.id)` and updates local state
5. Optionally dim rows where `is_test === true` with `opacity-50` styling

No database changes needed — `is_test` and `original_message_text` columns already exist on `conversation_mappings`.

