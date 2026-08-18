# Option C — Intercom-sourced field options

Stop hand-maintaining lists of valid field values in the Hub. Fetch the real options from Intercom's data-attributes API, cache them in a table, and validate writes against that cache. Same posture as the rest of the write path: never invent a value, surface drift loudly, keep the current lists as fallback until the cache is proven.

## What's wrong today

Three lists, three places, none verified against Intercom:

- Product area — `settings.product_areas`, hand-typed, consumed by 8 surfaces plus `auto-categorize-product-area`.
- Ticket type — hardcoded array in `esh-write-action` and mirrored again in `TicketFieldWriteControls.tsx`.
- Owner — derived from `settings.admin_owner_map`.

If someone edits the dropdown in Intercom, the Hub keeps offering the old set and a write fails at the API with a message the operator can't act on — or worse, a value silently stops matching what the sync reads back.

## Phasing

Two passes, each independently shippable. Phase 1 adds the cache and makes drift visible without changing a single validation path. Phase 2 flips validation over to the cache, one field at a time, with the pinned list kept as fallback.

Owner is explicitly out of scope for both phases — it resolves through `teammates.intercom_admin_id`, which is already Intercom-derived and already refuses unknown targets.
