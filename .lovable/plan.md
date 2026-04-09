

## Post customer-facing replies from the Lovable app

### What it does
Adds a "Reply" composer to the conversation detail page. When you type a message and hit send, the app publishes it to the original platform:

- **Intercom**: Posts an admin reply to the linked Intercom conversation
- **Slack**: Posts a message to the Slack thread
- **Gmail**: Sends a reply email to the Gmail thread

The reply also appears inline in the thread view immediately.

### How it works

**1. New edge function: `post-reply`** (`supabase/functions/post-reply/index.ts`)

A single edge function that accepts `{ conversationId, source, message }` and routes to the correct platform API:

- **Intercom path**: Uses `INTERCOM_API_TOKEN` to call `POST /conversations/{intercomId}/reply` as admin (using `intercom_assignee_id` from settings). Requires the conversation to have an `intercom_conversation_id`.
- **Slack path**: Uses `SLACK_BOT_TOKEN` to call `chat.postMessage` with `channel` and `thread_ts` from the conversation mapping.
- **Gmail path**: Uses stored OAuth tokens from `gmail_oauth_tokens` to call `POST /gmail/v1/users/me/messages/send` with proper `In-Reply-To` and `References` headers to keep it in the same thread.

After posting, the function also updates the conversation status to `awaiting_customer` (since an admin just replied) and optionally inserts the message into `manual_messages` for manual-source conversations.

**2. UI: Reply composer on ConversationDetail** (`src/pages/ConversationDetail.tsx`)

- Add a textarea + send button below the thread/messages section
- On submit, call `supabase.functions.invoke("post-reply", { body: { conversationId, source, message } })`
- Show a loading spinner while sending
- On success, refresh the thread and show a toast
- The composer is visible for all sources but shows a helpful message if the required link is missing (e.g. "No Intercom ticket linked — create one first")

**3. Config** (`supabase/config.toml`)

Add `[functions.post-reply]` with `verify_jwt = false`.

**4. Flow diagram update** (`src/pages/FlowDiagram.tsx`)

Document the new outbound reply capability.

### Platform-specific details

| Source | API used | Auth | Thread linking |
|--------|----------|------|----------------|
| Intercom | `POST /conversations/{id}/reply` (v2.11) | `INTERCOM_API_TOKEN` | `intercom_conversation_id` |
| Slack | `chat.postMessage` | `SLACK_BOT_TOKEN` | `slack_channel_id` + `slack_thread_ts` |
| Gmail | `messages.send` with RFC 2822 reply headers | OAuth tokens from `gmail_oauth_tokens` | `gmail_thread_id` + `In-Reply-To` header |

### Files to create/edit
- `supabase/functions/post-reply/index.ts` — new edge function
- `supabase/config.toml` — add function config
- `src/pages/ConversationDetail.tsx` — add reply composer UI
- `src/pages/FlowDiagram.tsx` — document outbound replies

