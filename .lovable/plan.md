

## Fix: Duplicate variable declaration crashing `slack-interactions`

### Problem
The `slack-interactions` edge function is completely down. Every request returns a boot error:
```
Uncaught SyntaxError: Identifier 'fullBody' has already been declared at line 147
```

Line 173 in `supabase/functions/slack-interactions/index.ts` is a duplicate of line 172:
```typescript
const fullBody = bodyParts.join("\n\n");  // line 172
const fullBody = bodyParts.join("\n\n");  // line 173 — duplicate, must be removed
```

### Fix
Delete line 173 (the duplicate `const fullBody = bodyParts.join("\n\n");`). One-line change.

This will restore the function immediately — no config or secret changes needed.

