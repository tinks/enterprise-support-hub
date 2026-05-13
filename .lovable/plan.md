What the "3 active" badge means

The Filters header counts every filter that differs from its default, including ones that have no visible control in the Filters panel. On `/my/kristina` the three active items are:

1. Owner = Kristina — forced by the `/my/<owner>` route, no visible control on owner dashboards.
2. Status filter modified — the panel shows "0 hidden", but the default for the inbox is 3 hidden statuses (`test`, `cancelled`, `resolved`). Different from default, so it counts.
3. A persisted Product area or Classification value left over in `localStorage` from a previous session (the conversations page restores `conv-pa-filter` / `conv-class-filter` on every load).

Items 1 and 3 are not visible in the Filters panel today. Owner is hidden when `forceOwner` is set, and Product area / Classification only have controls in the table column headers, not in the Filters panel. That is why expanding Filters appears empty.

Fix proposal

1. Surface every active filter in the Filters panel.
   - Add Product area and Classification dropdowns to the Filters panel, identical in behaviour to the column-header filters. They stay in sync with the column-header filters.
   - On owner dashboards, show a read-only "Owner: Kristina" chip in the Filters panel so the user can see why rows are scoped. No clear button (route owns this).
   - Keep Source, Status, Date as today.

2. Make the active count match what the panel shows.
   - Continue counting the forced owner on owner dashboards (it is a real, visible filter chip now).
   - Continue counting Status when it differs from the default.
   - Continue counting Product area and Classification (now editable in the panel).

3. Reset behaviour
   - "Reset" inside the Filters panel clears Source, Status (back to default), Date, Product area, Classification.
   - On owner dashboards Reset still preserves the route-forced owner.
   - On `/conversations` Reset still clears owner to All.

Out of scope

- No backend or query changes.
- No changes to the conversations table structure or pagination.
- No changes to the column-header filter UI; we just add a parallel control in the Filters panel.

Validation

- Open `/my/kristina`. The Filters panel shows: read-only Owner = Kristina chip, Source, Status, Date, Product area, Classification. Counted items match the badge.
- Change Product area in the Filters panel — column-header filter updates too, and rows refilter.
- Click Reset — Source/Status/Date/Product area/Classification reset, Owner stays Kristina.
- Open `/conversations` — Owner chip is editable as before, Reset clears it to All.