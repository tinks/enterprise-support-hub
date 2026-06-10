---
name: Intercom Custom Field Mapping
description: Maps Intercom custom_attributes "Affected Product Area" → product_area and "Ticket type" → classification on import
type: feature
---
On every Intercom import path, the Intercom REST response's `custom_attributes` are mapped onto the local row:

- `custom_attributes["Affected Product Area"]` → `product_area`
- `custom_attributes["Ticket type"]` → `classification`

A shared helper `extractIntercomCustomFields(icData)` lives in each relevant function. It trims values and omits empty/missing ones so we never overwrite an existing value with blank on upsert.

Applied in:
- `import-intercom-ticket` — spread into the `manual_conversations` insert.
- `poll-intercom-inbox` — spread into both the `gmail_conversations` link `updatePayload` and the new `manual_conversations` `insertPayload`.
- `intercom-webhook` — spread into both `gmail_conversations` link `updatePayload`s (direct email match + subject fallback) and into `pending_intercom_links.source_payload`.
- `promote-pending-intercom-links` — reads `product_area`/`classification` back out of `source_payload` and spreads them into the promoted `manual_conversations` insert.

The duplicate-detection early return in `intercom-webhook` (when the ticket is already tracked) does NOT re-fetch from Intercom, so it does not update these fields on existing rows — a separate backfill job would be needed to retroactively populate `product_area`/`classification` on historical imports.
