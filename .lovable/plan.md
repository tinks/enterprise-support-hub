

## Add "Tine" dashboard under Kristina

Add a third entry to the Dashboards flyout in the sidebar so `/my/tine` is available alongside Joel and Kristina. Reuses the existing `OwnerDashboard` route — no new page needed.

### Change

**`src/components/AppLayout.tsx`** — append to `dashboardItems`:
```ts
const dashboardItems = [
  { to: "/my/joel", label: "Joel" },
  { to: "/my/kristina", label: "Kristina" },
  { to: "/my/tine", label: "Tine" },
];
```

The existing `/my/:owner` route in `App.tsx` capitalizes the param and passes it to `Conversations` as `forceOwner="Tine"`, so filtering works automatically as long as "Tine" appears as an owner value on conversations.

### Note

If "Tine" isn't yet a recognized owner in the conversation data / owner dropdown options, the dashboard will render but show an empty list. Let me know if I should also add Tine to the owner options list (would need to point me at where owners are defined — likely a constant or the `sender-attribution` mapping).

### Out of scope

- Adding Tine to admin ID → owner mappings in edge functions (separate request if needed).
- Reordering or grouping dashboard entries.

