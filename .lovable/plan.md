

## Fix Intercom import: message ordering, filtering, and subject formatting

### Problem
1. **Subject has raw HTML tags** — The subject stored from Intercom contains `<p>...</p>` tags that display literally
2. **Internal notes imported** — Assignment events, bot status notes ("Sam is working"), and other internal Intercom parts are included as messages
3. **Message ordering** — Messages should display with the initial message first, then chronologically

### Implementation

**`supabase/functions/import-intercom-ticket/index.ts`**

1. **Strip HTML from subject** (line 90) — Apply `stripHtml` to the subject before saving:
   ```ts
   const subject = stripHtml(icData.source?.subject || icData.title || `Intercom #${intercomConvId}`);
   ```
   Move the `stripHtml` helper definition above the subject extraction (before line 90).

2. **Filter out internal notes and system parts** (line 140) — Skip conversation parts that are internal notes or system events. Intercom parts have a `part_type` field; filter out:
   - `part_type === "note"` (internal notes)
   - `part_type === "assignment"` (team assignment changes)  
   - `part_type === "open"` / `"close"` (status changes)
   - Parts where `author.type === "bot"` (bot status messages like "Sam is working")
   
   Add a filter before processing each part:
   ```ts
   const SKIP_PART_TYPES = new Set(["note", "assignment", "open", "close", "away_mode_assignment"]);
   for (const part of parts) {
     if (!part.body) continue;
     if (SKIP_PART_TYPES.has(part.part_type)) continue;
     if (part.author?.type === "bot") continue;
     // ... rest of processing
   }
   ```

3. **Ensure chronological order** — Messages are already inserted in order (source message first, then parts in API order). The detail page fetches `manual_messages` ordered by `created_at` ascending, so this is correct. No change needed.

**`src/pages/ConversationDetail.tsx`**

4. **No changes needed** — The detail page already displays messages in order and the subject is rendered from the database value. Fixing the data at import time resolves the display issues.

### Files to edit
- `supabase/functions/import-intercom-ticket/index.ts`

