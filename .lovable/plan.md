

## Preserve per-message timestamps when parsing threads

### Problem
The parser extracts timestamps from pasted thread text to split messages, but discards them. All messages are inserted with `created_at = now()`, losing the actual send times.

### Solution
1. Add a `sent_at` field to `ParsedMessage`
2. Update all four regex formats (A–D) and the AI parser to capture and return the timestamp
3. Combine the user-picked thread date with each message's parsed time to produce a full datetime
4. Pass `created_at` when inserting into `manual_messages`

### Changes

**`src/lib/parseThread.ts`**
- Add `sent_at?: string` to `ParsedMessage` interface
- Update `parts` array to also store the parsed time string (e.g. `"1:47 PM"`)
- For Format A (`Name [1:47 PM]`): already captures time in group 2 — store it
- For Format B (`Name\n  Mar 26th at 11:03 AM`): captures full date+time — store both
- For Format C (`Name  5:43 AM`): captures time in group 2 — store it
- For Format D (`Name  3/26/2025 11:03 AM`): captures date+time — store full datetime
- Add a helper `combineDateTime(date: Date, timeStr: string): string` that merges the thread date with the parsed time into an ISO string
- In `parseThreadWithAI`, update the AI tool schema to also request `sent_at` for each message

**`supabase/functions/parse-thread/index.ts`**
- Add `sent_at` (optional string, the raw timestamp text) to the tool function schema so the AI returns timestamps too

**`src/components/ManualLogTab.tsx`**
- After parsing, call `combineDateTime(threadDate, msg.sent_at)` for each message
- When inserting into `manual_messages`, include `created_at` per message
- For Format B/D where full date is embedded in the timestamp, use that date directly (no need for the date picker)

### Technical detail: combining date + time
Formats A and C only have time (e.g. `1:47 PM`), so they need the user-picked thread date. Formats B and D include the date, so the full datetime can be constructed directly. A helper function will handle both cases.

### Files to edit
- `src/lib/parseThread.ts` — capture and return timestamps
- `supabase/functions/parse-thread/index.ts` — add `sent_at` to AI schema
- `src/components/ManualLogTab.tsx` — pass `created_at` per message on insert
- `src/pages/FlowDiagram.tsx` — document that manual imports preserve per-message timestamps

