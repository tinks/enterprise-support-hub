

## Auto-link Intercom tickets to existing Gmail conversations

### Problem
When an Intercom conversation is assigned to the enterprise inbox, the webhook auto-imports it as a new `manual_conversations` record. But if the same customer already has a `gmail_conversations` record (from Gmail polling), the two are never linked. This creates duplicates and means the Gmail record never shows its Intercom ticket.

### Solution
In the intercom-webhook's assignment handler, after confirming the conversation isn't already tracked, extract the contact's email from the Intercom conversation data and check if a matching `gmail_conversations` record exists. If found, update that Gmail record with the `intercom_conversation_id` instead of creating a new `manual_conversations` row.

### Changes

**File: `supabase/functions/intercom-webhook/index.ts`** (~line 268-389, assignment auto-import block)

After the existing duplicate check (lines 218-243) and Intercom API fetch (line 268), add logic to:

1. Extract the contact's email from the Intercom conversation data (from `icData.source.author.email` or by fetching the contact via the contacts API using the contact ID in the conversation)
2. If an email is found, query `gmail_conversations` for unlinked records (`intercom_conversation_id IS NULL`) matching that email via `from_email`, `to_emails`, or `cc_emails`
3. If a match is found, update the Gmail record(s) in that thread with the `intercom_conversation_id` and owner, then return early — skip creating a `manual_conversations` entry
4. If no Gmail match, proceed with the existing `manual_conversations` insert as before

**File: `src/pages/FlowDiagram.tsx`**
Update the relevant node to document that the assignment handler now cross-references Gmail records before creating manual entries.

### Technical detail

```text
Intercom webhook (assignment) flow:
  1. Check enterprise inbox ✓
  2. Check if intercom_conversation_id already tracked ✓
  3. Fetch conversation from Intercom API ✓
  4. [NEW] Extract contact email from conversation
  5. [NEW] Search gmail_conversations for matching email (unlinked)
  6. [NEW] If found → UPDATE gmail thread with intercom_conversation_id + owner → return
  7. Otherwise → create manual_conversations entry (existing behavior)
```

### Files to edit
- `supabase/functions/intercom-webhook/index.ts` — add Gmail cross-reference before manual insert
- `src/pages/FlowDiagram.tsx` — update flow documentation

