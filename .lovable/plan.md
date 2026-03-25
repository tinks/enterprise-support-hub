

## Add "Cancel" Button to Context Prompt

### Overview
Add a third button to the context prompt that lets users dismiss their support request without creating an Intercom ticket. This resolves the conversation immediately.

### Changes

**1. `supabase/functions/slack-events/index.ts` — Add button to prompt (line ~360)**

Add a "Cancel" button after the "Proceed" button in the actions block:
```typescript
{
  type: "button",
  text: { type: "plain_text", text: "Cancel", emoji: true },
  action_id: "cancel_request",
  value: buttonValue,
}
```

**2. `supabase/functions/slack-interactions/index.ts` — Handle the button click**

Add a new `cancel_request` action handler (similar to the existing `proceed_without_context` block):
- Atomically update status from `awaiting_context` → `resolved` (prevents double-processing)
- Update the prompt message via `chat.update` to show a cancellation acknowledgment (e.g., "✅ Request cancelled. Feel free to reach out again anytime!")
- No Intercom ticket created, no reactions added
- Return 200

**3. `bot_messages` table — Add `request_cancelled` message key**

Insert a new editable message:
- Key: `request_cancelled`
- Text: `"✅ Request cancelled. Feel free to reach out again anytime!"`
- Description: `"Message shown when user cancels their support request"`

**4. `context-reminder` function — Skip cancelled conversations**

The existing query filters on `status = 'awaiting_context'`, so cancelled (resolved) conversations are already excluded. No change needed.

### What stays the same
- "Add Details" and "Proceed" buttons unchanged
- No Intercom interaction on cancel
- Auto-proceed reminder logic unaffected (status guard prevents action on resolved conversations)

