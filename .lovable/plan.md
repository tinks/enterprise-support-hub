

## Show user names instead of Slack IDs in the inbox

### Problem
The "Sent by" column for Slack bot conversations shows raw Slack user IDs (e.g. `U07JWU8692B`) when the user isn't found in the lookup. This happens because the `list-slack-users` call doesn't include deactivated or guest users.

### Change

**File: `src/pages/Conversations.tsx`** (~line 606)

Update the `list-slack-users` invocation in `loadLookups` to pass `include_deactivated=true` as a query parameter, so deactivated and guest users are resolved to display names.

Current:
```typescript
const usersRes = await supabase.functions.invoke("list-slack-users");
```

Updated:
```typescript
const usersRes = await supabase.functions.invoke("list-slack-users", {
  body: { include_deactivated: true },
});
```

Wait — `list-slack-users` reads `include_deactivated` from URL search params, not the body. Since `supabase.functions.invoke` doesn't support query params natively, we need to pass it in the function name path:

```typescript
const usersRes = await supabase.functions.invoke("list-slack-users?include_deactivated=true");
```

Or alternatively, update the edge function to also accept the flag from the JSON body. The simpler fix is to update the edge function to check both the query param and the request body.

**File: `supabase/functions/list-slack-users/index.ts`**

Add a fallback to read `include_deactivated` from the request body (for POST requests) in addition to query params, so the existing `supabase.functions.invoke` call can pass it as body.

### Files to edit
- `supabase/functions/list-slack-users/index.ts` — accept `include_deactivated` from body
- `src/pages/Conversations.tsx` — pass `{ include_deactivated: true }` in the invoke body

