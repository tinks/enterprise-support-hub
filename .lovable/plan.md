

## Add "reply in thread" hint below feedback buttons

### What changes

**1. `supabase/functions/intercom-webhook/index.ts`** (line ~482, after the `actions` block is pushed)

Add a `context` block with gray italic text right after the buttons on the last chunk:

```typescript
blocks.push({ type: "actions", elements: actionElements });
blocks.push({
  type: "context",
  elements: [{ type: "mrkdwn", text: "_To continue chatting with Sam, please send a reply in the thread_" }],
});
```

Slack `context` blocks render in small gray text — exactly the look you described.

**2. `src/pages/FlowDiagram.tsx`** — Node "5" message preview

Update the `message` field to include the hint text so it's visible in the flow diagram:

```
"[AI reply text...]\n\n[ 👍 This resolved my issue ]  [ 👎 Escalate to human ]\n\n_To continue chatting with Sam, please send a reply in the thread_"
```

### Scope
Two files, minimal changes. No schema or migration changes.

