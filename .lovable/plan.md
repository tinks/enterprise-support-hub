

## AI-powered thread parsing fallback

### Problem
The current regex parser handles two Slack copy formats but fails on a third common one: `Name  5:43 AM` (time without brackets). There will always be more edge cases — new Slack versions, mobile copy formats, etc. Rather than endlessly adding regexes, use AI as a fallback when regex parsing fails.

### Solution

**Two-pass approach**: Try regex first (fast, free), fall back to AI when regex returns zero messages.

**`supabase/functions/parse-thread/index.ts`** (new edge function)
- Accepts `{ rawThread: string }` 
- Sends the raw thread text to Lovable AI with a system prompt instructing it to extract structured messages
- Uses tool calling to get structured output: array of `{ sender_name, message_text }` objects
- Returns the parsed messages array
- Uses `LOVABLE_API_KEY` (already available)

**`src/lib/parseThread.ts`** — add Format C regex + AI fallback helper
- Add Format C: `Name  HH:MM AM/PM` (no brackets) as a quick regex fix for this specific case
- Export a new `parseThreadWithAI(raw: string)` async function that calls the edge function when all regexes fail
- Keep `parseThread()` synchronous for backward compatibility

**`src/components/ManualLogTab.tsx`** — update parse handler
- When `parseThread()` returns empty, call `parseThreadWithAI()` as fallback
- Show a toast like "Using AI to parse thread..." while waiting
- If AI also fails, show error

**`src/pages/TestChannelReview.tsx`** — same fallback in the Log & replace dialog

### Technical details

**Edge function system prompt** (simplified):
```
Parse this Slack thread into individual messages. 
Extract each message's sender name and message text.
Ignore timestamps, reply counts, reactions, and metadata.
```

**Tool calling schema** for structured output:
```json
{
  "name": "extract_messages",
  "parameters": {
    "type": "object",
    "properties": {
      "messages": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "sender_name": { "type": "string" },
            "message_text": { "type": "string" }
          },
          "required": ["sender_name", "message_text"]
        }
      }
    },
    "required": ["messages"]
  }
}
```

**Format C regex** (added to `parseThread`):
```
/^(.+?)\s{2,}(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm
```
This catches `Name  5:43 AM` without brackets — requires 2+ spaces before time to avoid false positives.

### Files to create/edit
- `src/lib/parseThread.ts` — add Format C regex + export `parseThreadWithAI()`
- `supabase/functions/parse-thread/index.ts` (new) — AI parsing edge function
- `src/components/ManualLogTab.tsx` — use AI fallback in parse handler
- `src/pages/TestChannelReview.tsx` — use AI fallback in Log & replace
- `src/pages/FlowDiagram.tsx` — note AI parsing fallback

