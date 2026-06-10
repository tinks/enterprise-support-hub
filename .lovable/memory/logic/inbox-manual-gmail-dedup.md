---
name: Inbox manual↔gmail dedup
description: Inbox view suppresses manual_conversations rows whose intercom_conversation_id already appears on a gmail_conversations row, so each Intercom ticket shows once
type: feature
---
In `src/pages/Conversations.tsx` `unified` memo, when building rows we collect every `intercom_conversation_id` present in `gmailData` and skip any `manual_conversations` row sharing that id. Gmail is treated as source of truth (mirrors the analytics dedup behavior in `mem://logic/gmail-thread-dedup`). Manual rows without `intercom_conversation_id`, or whose Intercom id has no matching Gmail row, still render.
