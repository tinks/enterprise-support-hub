

## Fix: File-only messages not forwarded to Intercom

### Problem
Line 369 in `slack-events/index.ts` requires `!event.subtype` for thread replies. When a user uploads a file in Slack, the event has `subtype: "file_share"`, causing it to be silently dropped. No file-share messages ever reach Intercom.

### Fix — `supabase/functions/slack-events/index.ts`

**Line 369**: Change the subtype check to allow `file_share` alongside no-subtype messages:

```typescript
const isRegularMessage = !event.subtype || event.subtype === "file_share";
if (event.type === "message" && isRegularMessage && event.thread_ts && event.user) {
```

One line change. The rest of the file handling logic (lines 424-431) already handles `event.files` correctly — it downloads, re-hosts, and attaches them. The only issue was the gate at the top rejecting the event.

### Scope
One file, one condition change. No schema changes.

