

## Redirect to conversation after manual save

### Change
In `src/components/ManualLogTab.tsx`, after a successful save (line 189), navigate to the new conversation's detail page instead of just showing a toast.

**Line ~189**, after `toast.success("Conversation logged")`, add:
```typescript
navigate(`/conversations/${convo.id}?source=manual`);
```

The component already imports `useNavigate` and has `navigate` available. The `convo.id` is already in scope from the insert result. This matches the pattern used in the Intercom import handler.

The form reset (lines 193-202) can remain — it won't matter since the user navigates away.

### Files to change
- `src/components/ManualLogTab.tsx` — add one line after toast.success

