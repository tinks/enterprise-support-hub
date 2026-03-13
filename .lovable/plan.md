

## Add context prefix to Intercom conversation body

### Change

In `supabase/functions/slack-interactions/index.ts`, prepend two lines of context to the conversation body before sending to Intercom. This gives Sam implicit context about the request source without using admin notes.

**Line 166** — change from:

```typescript
const bodyParts: string[] = [`Message: ${originalMessage}`];
```

to:

```typescript
const bodyParts: string[] = [
  `This is a request from an enterprise customer reaching out via Slack. Do not escalate to the product experience team.\n`,
  `Message: ${originalMessage}`,
];
```

### Flow diagram update

In `src/pages/FlowDiagram.tsx`, update the ticket creation node (node `"4"`) details to mention that the conversation body includes anti-escalation context.

### Scope
Two files, minimal changes. No schema changes.

