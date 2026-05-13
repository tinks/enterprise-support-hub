## Update project-knowledge.md

Document the new dashboard default-filter behaviour so the knowledge file stays in sync with the code.

### Edit 1 — `/my/:owner` row in the routes table (line 69)

Replace the terse description with:

> Per-person dashboard (Joel, Kristina, Sam, CSM, Eren, Tine). Renders `<Conversations forceOwner={ownerName} key={ownerName} />` so each route remounts with its own state. **Defaults on dashboards:** Owner = route owner (read-only chip, not editable), Status hides only `resolved` (`DASHBOARD_HIDDEN`), all other filters cleared. The Filters panel shows no "active" badge in this clean state. Dashboard tinkering with Status / Product area / Classification does **not** persist to localStorage, so it can't leak into the inbox. `Reset` keeps the forced owner and restores `DASHBOARD_HIDDEN`.

### Edit 2 — append a new short section after the existing inbox/dashboard notes (around line 511, before "Resolution time — manual override")

```
## Conversations filter defaults — inbox vs dashboards

Two defaults coexist in `src/pages/Conversations.tsx`:

- `DEFAULT_HIDDEN = {test, cancelled, resolved}` — used on `/conversations` (the inbox). Persists user picks via `conv-hidden-statuses`, `conv-pa-filter`, `conv-class-filter`, `conv-owner-filter`.
- `DASHBOARD_HIDDEN = {resolved}` — used on `/my/<owner>` whenever `forceOwner` is set. Owner is locked to the route owner. localStorage writes for hidden statuses, product area, and classification are skipped while `forceOwner` is set so dashboards never overwrite inbox defaults.

`effectiveDefaultHidden = forceOwner ? DASHBOARD_HIDDEN : DEFAULT_HIDDEN` drives the "active filter" badge, the Status popover's "Restore defaults" button, and `resetAll`. The forced owner is excluded from the active-filter count.
```

No code or Flow page changes — knowledge file only.