

## Fix "continue chatting with Sam" hint on human admin replies

### Problem

When a human admin (e.g. Joel) replies via Intercom, the hint still says "To continue chatting with Sam, please send a reply in the thread" — it should say something like "To continue chatting, please send a reply in the thread" (dropping "with Sam").

### Change in `supabase/functions/intercom-webhook/index.ts`

**Lines 763-766** — Make the hint text conditional on `isHumanAdmin`:

```typescript
const hintText = isHumanAdmin
  ? "_To continue chatting, please send a reply in the thread_"
  : "_To continue chatting with Sam, please send a reply in the thread_";
blocks.push({
  type: "context",
  elements: [{ type: "mrkdwn", text: hintText }],
});
```

**Line 740** (incident.io branch) — Same fix: use the conditional hint text instead of hardcoded "with Sam".

### Summary
- 1 file changed (`intercom-webhook/index.ts`)
- 2 lines updated to make hint text dynamic based on reply author

