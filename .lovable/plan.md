## Goal

After a successful Slack thread import on the Import page, automatically navigate to the new conversation's detail page so you can immediately triage it.

## Change

**File:** `src/components/ImportTab.tsx` (single edit in `handleImport`, ~line 125)

The `import-slack-thread` edge function already returns the inserted row as `data.conversation` (with `id`). We just need to consume it:

```tsx
toast.success("Thread imported successfully", {
  description: `Channel: ${data.channelName}`,
});
setUrl("");
loadRecentImports();
if (data?.conversation?.id) {
  navigate(`/conversations/${data.conversation.id}?source=slack`);
}
```

## Behavior

- **Success** → toast + navigate to `/conversations/<id>?source=slack` (the conversation detail page where messages and inline notes render).
- **Already imported** → no change; existing toast still offers a "View" action button to jump to the existing thread.
- **Failure** → no change; error toast shown, stay on Import page.

## Out of scope

- Intercom imports and bulk imports (`handleIntercomImport`, etc.) — only the Slack URL import flow was requested.
- No Flow page or project-knowledge update needed (no logic change, just a UX redirect).
