

## Enhance imported Slack threads: resolution tracking + Intercom ticket creation

### What's possible

**Resolution/response time tracking** — Yes. The `import-slack-thread` edge function already calls `conversations.replies` from Slack. We can fetch ALL replies (not just the first), extract timestamps, identify the first admin reply (response time) and the last message or a resolved status (resolution time), and store these on the `conversation_mappings` row.

**Intercom ticket creation** — Yes. The existing `createIntercomTicket` helper in `slack-interactions` already handles the full flow (find/create contact, create conversation, assign to inbox/agent, poll for AI reply). We can reuse the same Intercom creation logic in the import function, or add a "Create Intercom ticket" button on the conversation detail page that triggers a new edge function.

### Approach

#### 1. Enrich import with full thread data

**`supabase/functions/import-slack-thread/index.ts`**

- Fetch ALL replies from the thread (paginated `conversations.replies` with `limit=200`)
- Identify the first non-bot admin reply timestamp → compute response time from thread start
- Store `resolved_at` if the thread has a resolution indicator (or leave null for manual marking)
- Optionally store reply count for quick reference

#### 2. Add "Create Intercom ticket" action

**`supabase/functions/create-intercom-from-import/index.ts`** (new edge function)

- Accepts `mappingId` as input
- Loads the conversation mapping from DB
- Looks up Slack user email via `users.info`
- Finds or creates Intercom contact
- Creates Intercom conversation with the original message text + full thread transcript
- Assigns to configured inbox and agent (Sam)
- Updates `conversation_mappings` with `intercom_conversation_id` and `intercom_contact_id`
- Returns success with Intercom conversation ID

**`supabase/config.toml`** — Add `verify_jwt = false` for the new function

#### 3. UI: add "Create Intercom ticket" button

**`src/pages/ConversationDetail.tsx`**

- For imported conversations (has `slack_channel_id`/`slack_thread_ts` but no `intercom_conversation_id`), show a "Create Intercom ticket" button
- On click, call the new edge function
- On success, reload the conversation to show the Intercom link

#### 4. Documentation

**`src/pages/FlowDiagram.tsx`** — Document that imported threads can now create Intercom tickets and track response/resolution times

### Files to create/edit
- `supabase/functions/import-slack-thread/index.ts` — fetch full thread, compute timing metrics
- `supabase/functions/create-intercom-from-import/index.ts` (new)
- `supabase/config.toml` — register new function
- `src/pages/ConversationDetail.tsx` — add "Create Intercom ticket" button
- `src/pages/FlowDiagram.tsx` — document changes

