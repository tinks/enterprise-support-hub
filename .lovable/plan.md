## Add CSV export to Inbox V2

Frontend-only change in `src/pages/InboxV2.tsx`.

### UI
- New "Export CSV" button next to "Reset columns" in the filter row
- Clicking opens a small popover with:
  - **Preset** dropdown: Last 7 days · Last 14 days · Last 30 days · This month · Last month · Custom
  - **From / To** date pickers (auto-filled by preset; editable for Custom)
  - **Export** button (shows spinner while fetching)

### Behavior
- Query the DB directly on export — not limited to the 500 loaded rows
- Filter: `intercom_created_at` between From (00:00) and To (23:59:59)
- Screen filters layer on top: status, owner, product area, classification, tags, and search all still apply within the date range
- Paginated fetch in 1000-row batches until exhausted (handles months with >1000 tickets)
- Filename: `inbox-v2-YYYY-MM-DD_to_YYYY-MM-DD.csv`
- Toast on completion: "Exported N tickets"

### CSV columns
- Intercom ID
- Subject
- Contact name
- Contact email
- Owner
- Product area
- Classification
- Tags (semicolon-joined)
- Status
- Created (`intercom_created_at`, ISO)
- Updated (`intercom_updated_at`, ISO)

### Technical notes
- Proper CSV quoting (commas, quotes, newlines)
- Download via `Blob` + temp `<a>` — no new dependencies
- Uses shadcn `Popover` + `Calendar` (already in the project)
- No backend, schema, or edge function changes
