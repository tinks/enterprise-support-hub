

## Problem

The Intercom tagging API call logs "success" but the tag never actually gets applied. The code only catches network errors (via `try/catch`), but `fetch` doesn't throw on HTTP 4xx/5xx responses — so the API is likely returning an error silently.

Additionally, the tagging format used (`POST /tags` with `conversations` array) is from an older Intercom API version and may not work with the current API.

## Root Cause

The Intercom REST API v2.x changed how conversation tagging works. The current code uses:

```
POST /tags  →  { name: "Slack", conversations: [{ id: "..." }] }
```

The modern approach requires two steps, or a single call to the conversation-specific endpoint:

```
POST /conversations/{conversation_id}/tags  →  { id: "<tag_id>" }
```

## Plan

**File: `supabase/functions/slack-interactions/index.ts`**

1. **Log the tag API response** — capture the HTTP status and body so we can see what Intercom actually returns (immediate debugging).

2. **Switch to the correct tagging endpoint**:
   - First, find or create the "Slack" tag via `POST /tags` with `{ name: "Slack" }` and capture the returned tag `id`.
   - Then, attach it to the conversation via `POST /conversations/{conversationId}/tags` with `{ id: tagId }`.

3. **Add `Intercom-Version` header** (`2.11`) to all Intercom API calls to ensure consistent behavior.

This is a small, isolated change in the `createIntercomTicket` function (lines 167-180).

