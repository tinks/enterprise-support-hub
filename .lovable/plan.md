

## Problem

The "👍 This resolved my issue" button does not work when the conversation status is `escalated`. The atomic guard (line 1058 in `slack-interactions/index.ts`) only allows the feedback action to proceed if the status is `active` or `awaiting_context`:

```typescript
.in("status", ["active", "awaiting_context"])
```

For conversation `215473546003313`, the status was auto-escalated (Sam's routing keywords triggered it), so both button clicks were rejected with "already processed." The ticket was never closed in Intercom.

## Fix

**1. `supabase/functions/slack-interactions/index.ts` — Expand the feedback guard**

Allow the positive feedback action (`feedback_positive`) to also transition from `escalated` status. This way, if a user clicks "resolved" on a conversation that was auto-escalated, it still closes properly.

Change line 1058 from:
```typescript
.in("status", ["active", "awaiting_context"])
```
to:
```typescript
.in("status", ["active", "awaiting_context", "escalated"])
```

This covers the scenario where Sam auto-escalated but the user still considers the issue resolved. The negative feedback path (`feedback_negative`) also benefits — though an escalated-to-escalated transition is a no-op, the Intercom reassignment call still fires, which is harmless.

**2. Deploy the updated `slack-interactions` edge function.**

**3. Update project knowledge** — Document that the feedback guard now accepts `escalated` status for resolution.

## Secondary Issue (Non-blocking)

The logs also show a `400` error when setting custom attributes on the conversation (`Slack channel` attribute does not exist in Intercom). This is a separate configuration issue that doesn't affect the resolution flow but should be investigated separately.

