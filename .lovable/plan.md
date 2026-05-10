## Apply April + "Unassigned product area" filter via URL params

On the Conversations page, the date range and product-area filters live in component state and `localStorage` only — there's no URL way to set them, so I can't just hand you a link. I'll add lightweight support for three new URL search params and then navigate your preview to a pre-filtered URL.

### Code change (small)
In `src/pages/Conversations.tsx`:
- Read three new search params on mount: `from` (ISO date), `to` (ISO date), `productArea` (string, e.g. `unassigned` or a specific area).
- If any are present, seed `dateFrom`, `dateTo`, and `productAreaFilter` from them (overriding the localStorage-restored defaults). Existing localStorage persistence keeps working afterwards, so the filter sticks.
- No UI changes; existing filter chips and "Clear filters" button continue to work.

### Then
Navigate the preview to:
```
/conversations?from=2026-04-01&to=2026-04-30&productArea=unassigned&source=all
```
That gives you all April tickets with product area set to "Unassigned" across Slack, Gmail, and manual.

### Bonus
After this you can bookmark filtered views (e.g. share a "March bugs without an owner" link). I won't touch the existing UI bug right now — once you can see the data we can decide whether the filter UI needs a follow-up fix.