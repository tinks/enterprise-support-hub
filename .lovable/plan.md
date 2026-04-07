

## Add "paste thread" mode to manual log

### What it does
Adds a "Paste thread" option to the manual log tab where you can type a channel name (e.g. `#ai-days-march`) and paste an entire copied Slack thread. The system parses it into individual messages automatically — extracting sender names, timestamps, and message text — so you don't have to manually add each message one by one.

### How it works

1. A toggle or tab at the top of the manual log card: "Log manually" vs "Paste thread"
2. In "Paste thread" mode, you see:
   - **Channel name** input (e.g. `#ai-days-march`) — saved as the source
   - **Thread text** — a large textarea where you paste the full copied thread
   - **Parse** button — extracts messages from the pasted text
3. The parser detects the pattern: `Name  [Time]\n Message text` (with optional `(edited)`, reply counts like `60 replies`, etc.)
4. After parsing, messages appear in the same editable message list as manual mode — you can fix any parsing errors before saving
5. The first user message's timestamp is used as `created_at` for the conversation
6. Contact name is auto-set from the first message sender
7. Source is set to `slack_thread` with the channel name stored

### Parser logic
The regex splits on lines matching `SomeName  [HH:MM AM/PM]` or `SomeName [HH:MM AM/PM]`. For each match:
- Extract sender name and timestamp
- Everything until the next sender line is the message text
- Lines like `60 replies`, `(edited)`, thread metadata are stripped
- Messages from known admins (Joel Samuelson, Kristina Bodurova) are tagged as `admin` role; others as `user`

### Technical details

**`src/components/ManualLogTab.tsx`**
- Add a `mode` state: `"manual" | "paste"`
- Add `channelName` and `rawThread` state for paste mode
- Add `parseThread()` function that uses regex to split the pasted text into `ManualMessage[]`
- On parse, populate the existing `messages` state, `contactName`, and `subject` (first ~60 chars of first message)
- Compute `created_at` from parsed timestamps (combine with today's date or let user pick a date)
- Add a date picker for the thread date since pasted timestamps only have time, not date
- Pass `created_at` override to `handleSave` when in paste mode
- Update `handleSave` to accept optional `created_at` for the conversation insert

**`src/pages/FlowDiagram.tsx`**
- Note paste-thread mode for manual logging

### Files to edit
- `src/components/ManualLogTab.tsx`
- `src/pages/FlowDiagram.tsx`

