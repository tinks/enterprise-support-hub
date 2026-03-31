

## Add manageable product area options via Settings page

### Approach
Store product areas in the `settings` table as a new text column (comma-separated list) and add a management section on the Settings page where you can add/remove options. The Conversations page will load these dynamically instead of using a hardcoded array.

### Database change
Add a column to `settings`:
```sql
ALTER TABLE settings
  ADD COLUMN product_areas text NOT NULL DEFAULT 'SSO,SCIM,Credits,Account access,Remix/transfer,Cloud/AI';
```

### Settings page (`src/pages/Index.tsx`)
Add a "Product areas" card section:
- Display current areas as removable badges (click X to remove)
- Input + "Add" button to append a new area
- Save alongside other settings, or auto-save on change
- Load from `settings.product_areas` (split by comma)

### Conversations page (`src/pages/Conversations.tsx`)
- Remove hardcoded `PRODUCT_AREAS` constant
- Fetch product areas from the `settings` row on mount (already fetched in some flows, or add a small query)
- Pass the dynamic list to the Select dropdowns

### Flow diagram (`src/pages/FlowDiagram.tsx`)
Document that product areas are now configurable via Settings.

### Files to edit
- Database migration (1 ALTER TABLE)
- `src/pages/Index.tsx` — add product areas management card
- `src/pages/Conversations.tsx` — load areas from settings instead of hardcoded array
- `src/pages/FlowDiagram.tsx` — document change

