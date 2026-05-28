## Fix broken hyperlink on "Recent low ratings" cards

The arrow-icon card in Stats → Customer satisfaction → "Recent low ratings (1–2★)" navigates to `/conversations/{source}/{id}`, but the route is defined as `/conversations/:id` (with `source` as a query param). The two-segment URL hits NotFound.

### Change

`src/pages/Stats.tsx` line 2088 — update the click handler to match the convention used elsewhere in the app (e.g. `Conversations.tsx:1158`):

```ts
onClick={() => navigate(`/conversations/${r.id}?source=${r.source}`)}
```

No other changes. Pure URL fix, no logic / data / styling change. No project-knowledge or Flow update needed.
