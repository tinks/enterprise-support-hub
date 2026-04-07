

## Fix: Include message body from assignment parts

### Problem
Your reply is tagged as `part_type=assignment` by Intercom (because you replied while reassigning the conversation). The current code unconditionally skips all `assignment` parts, which drops your message.

From the logs:
```
Part: type=assignment, author.type=admin, author.name=Joel Samuelson, hasBody=true  ← YOUR MESSAGE, SKIPPED
```

### Solution

**`supabase/functions/import-intercom-ticket/index.ts`**

Change the filtering logic: instead of skipping `assignment` parts entirely, only skip them if they have no body. The existing `if (!part.body) continue;` check already handles empty parts, so we just need to remove `"assignment"` from `SKIP_PART_TYPES`.

Updated skip set:
```
Before: ["assignment", "open", "close", "away_mode_assignment"]
After:  ["open", "close", "away_mode_assignment"]
```

Assignment parts without a body (pure reassignments) are already caught by `if (!part.body) continue;`. Assignment parts WITH a body (admin replied while reassigning) will now be included.

**`supabase/functions/intercom-webhook/index.ts`**

Apply the same change to the auto-import handler's `SKIP_PART_TYPES` set for consistency.

**`src/pages/FlowDiagram.tsx`**

Update flow to note that assignment parts with message bodies are now included.

### Files to edit
- `supabase/functions/import-intercom-ticket/index.ts`
- `supabase/functions/intercom-webhook/index.ts`
- `src/pages/FlowDiagram.tsx`

