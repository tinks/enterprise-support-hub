## Problem

Intercom links in the Inbox open `https://app.intercom.com/a/apps/esqnv6i1/conversations/<id>`, which Intercom redirects to the workspace landing page (`/a/apps/teb21d17`) instead of the actual ticket. The correct format (already used on the Conversation Detail page) is:

```
https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/<id>?view=List
```

## Changes

1. `src/pages/Conversations.tsx` line 462 — Inbox row link
   - Replace `https://app.intercom.com/a/apps/esqnv6i1/conversations/${intercomId}`
   - With `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${intercomId}?view=List`

2. `src/pages/Conversations.tsx` line 2148 — pending-links panel
   - Replace `https://app.intercom.com/a/inbox/_/inbox/conversation/${p.intercom_conversation_id}`
   - With `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${p.intercom_conversation_id}?view=List`

This aligns with the working links in `ConversationDetail.tsx` (lines 1194, 1555).

## Out of scope

- No changes to `Stats.tsx` (generic Intercom homepage link is intentional) or `ImportTab.tsx` (placeholder text).
- No project knowledge / Flow updates — pure URL fix, no logic change.