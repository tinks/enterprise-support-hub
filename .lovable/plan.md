

## Add "Import" tab with Slack thread URL import

### How it works
1. User pastes a Slack thread URL (e.g. `https://app.slack.com/client/T.../C08XXXXXX/thread/C08XXXXXX-1234567890.123456` or `https://yourteam.slack.com/archives/C08XXXXXX/p1234567890123456`)
2. The system parses the channel ID and thread timestamp from the URL
3. A new edge function calls the Slack API to fetch the thread's first message, author, and channel info
4. It inserts a new row into `conversation_mappings` with the parsed data
5. The UI shows a success confirmation with the imported conversation details

### URL parsing
Slack thread URLs come in formats like:
- `https://*.slack.com/archives/CXXXXXXXX/pTTTTTTTTTTTTTTTT` (single message / thread parent)
- `https://*.slack.com/archives/CXXXXXXXX/pTTTTTTTTTTTTTTTT?thread_ts=TTTTTT.TTTTTT`

The channel ID is the path segment starting with `C`/`G`/`D`, and the timestamp is derived from the `p` parameter (insert a dot before the last 6 digits).

### Changes

**New edge function: `supabase/functions/import-slack-thread/index.ts`**
- Accepts `{ url: string }`
- Parses channel ID and thread TS from the URL
- Calls Slack `conversations.replies` to get the parent message text and author
- Calls Slack `conversations.info` for the channel name
- Checks if a `conversation_mappings` row already exists for this channel+thread (prevent duplicates)
- Inserts a new row into `conversation_mappings` with: `slack_channel_id`, `slack_thread_ts`, `slack_user_id`, `original_message_text`, `status: 'active'`
- Returns the created row

**`supabase/config.toml`** — Add `[functions.import-slack-thread]` with `verify_jwt = false`

**New component: `src/components/ImportTab.tsx`**
- Text input for the Slack thread URL
- "Import" button that calls the edge function via `supabase.functions.invoke`
- Shows loading state, success with link to the imported conversation, and error handling
- Displays a list of recently imported conversations (last 10)

**`src/pages/Conversations.tsx`**
- Add a `Tabs` wrapper around the existing content with two tabs: "Conversations" (existing table) and "Import" (new component)

**`src/pages/FlowDiagram.tsx`** — Document the import functionality

### Files to edit
- `supabase/functions/import-slack-thread/index.ts` (new)
- `supabase/config.toml`
- `src/components/ImportTab.tsx` (new)
- `src/pages/Conversations.tsx`
- `src/pages/FlowDiagram.tsx`

