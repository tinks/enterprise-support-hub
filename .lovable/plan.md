

## Bug: Internal Notes from Sam Relayed to Slack

### Problem
Neither the `intercom-webhook` nor the `slack-interactions` polling code checks the `part_type` field on Intercom conversation parts. Intercom marks internal notes with `part_type: "note"`. Because this field is never inspected, internal notes (like "Sam is working...") are being treated as normal replies and posted to Slack.

The screenshot confirms: "Sam is working..." (an Intercom internal note) was relayed to the Slack thread along with a "continue chatting" hint.

### Root Cause
Two locations process Intercom conversation parts without filtering out notes:

1. **`intercom-webhook/index.ts` (line ~296)**: Extracts `lastPart` from `conversationParts` and processes it unconditionally — never checks `lastPart.part_type`.

2. **`slack-interactions/index.ts` (line ~431)**: The polling loop filters parts by `author.type` but does not filter out `part_type === "note"`.

### Plan

**File: `supabase/functions/intercom-webhook/index.ts`**
- After extracting `lastPart` (line ~296), add a guard: if `lastPart.part_type === "note"`, log it and return early with `{ ok: true, message: "Internal note skipped" }`.

**File: `supabase/functions/slack-interactions/index.ts`**
- In the polling filter (line ~431), add `p.part_type !== "note"` to the filter condition so internal notes are never picked up for relay.

**File: `src/pages/FlowDiagram.tsx`**
- Update the details for nodes 5 and 6c to document that internal notes (`part_type: "note"`) are filtered out.

### Technical Detail
Intercom conversation parts include a `part_type` field. Values include `"comment"` (visible replies), `"note"` (internal-only), `"assignment"`, etc. The fix adds a single field check in both relay paths.

