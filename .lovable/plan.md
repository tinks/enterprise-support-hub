

## Add "Sam is writing..." notice on active reply + fix flow diagram

### Backend: `supabase/functions/slack-events/index.ts`

Add an `else if (mapping.status === "active")` block before the existing `if (mapping.status === "escalated")` block (line 407). This new block will:

1. **Remove old feedback buttons** from the thread (same pattern as escalated block)
2. **Post "⏳ Sam is writing a response..."** notice in the thread

```
if (mapping.status === "active") {
  // Remove feedback buttons
  // Post "Sam is writing..." notice
} else if (mapping.status === "escalated") {
  // existing escalation logic
}
```

### Frontend: `src/pages/FlowDiagram.tsx`

**Add Node 6c** — "User replies in thread" between 6a and 6b (center position at `x: COL_W, y: ROW_H * 5.2`):
- Label: `6c. User replies in thread`
- Desc: "User replies without clicking a button. Old buttons removed, 'Sam is writing...' posted, reply forwarded."
- Icon: `MessageSquare`
- Edge function: `slack-events`
- Details: removes old feedback buttons, posts "⏳ Sam is writing...", forwards reply to Intercom
- Accent: blue

**Update edges:**
- Remove `e5-5loop` self-loop
- Add `e5-6c`: from 5 → 6c, label "Reply in thread"
- Add `e6c-5`: from 6c → 5, label "Sam responds again" (animated, blue stroke) — creates the loop

**Reposition 6a/6b** slightly to make room for 6c in the center:
- 6a: `x: COL_W - COL_W * 0.7`
- 6c: `x: COL_W`
- 6b: `x: COL_W + COL_W * 0.7`

