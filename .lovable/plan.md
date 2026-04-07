

## Bulk import review page with duplicate detection

### Overview

Create a dedicated `/import/bulk` page where you can upload Intercom CSV exports and see a side-by-side comparison of what's already tracked vs what's missing. The page performs fuzzy matching (not just by Intercom conversation ID) to catch potential duplicates before importing.

### How it works

1. Upload one or more Intercom CSV files (e.g. Joel March, Joel April, Kristina March, Kristina April)
2. The page parses each CSV client-side and extracts: conversation ID, title/subject, user email, user name, date, state, assigned teammate
3. For each row, it checks against all three conversation tables for matches:
   - **Exact match**: `intercom_conversation_id` matches in `manual_conversations`, `conversation_mappings`, or `gmail_conversations`
   - **Fuzzy match**: subject similarity against `manual_conversations.subject`, `conversation_mappings.original_message_text`, or `gmail_conversations.subject`; or email match against `gmail_conversations.from_email` or `manual_conversations.contact_name`
4. Each row gets a status badge: "Tracked" (exact ID match), "Possible duplicate" (fuzzy match found), or "Missing" (no match)
5. You can expand any row to see the matched conversation(s) and decide whether to import or skip
6. Select which "Missing" rows to import, then trigger bulk import with owner pre-filled from the CSV's assigned teammate

### New files

**`src/pages/BulkImportReview.tsx`**
- Full page with CSV file upload (multi-file, parsed with `Papa Parse` or manual CSV parsing)
- Groups results by file/admin
- Table with columns: Intercom ID, Subject, User, Date, Status (Tracked/Possible duplicate/Missing), Action
- Expandable rows showing matched conversations from the database
- "Import selected" button that calls the bulk import edge function
- Progress indicator during import

**`supabase/functions/bulk-import-intercom/index.ts`**
- Accepts array of Intercom conversation IDs + owner override
- For each ID: check duplicates, fetch from Intercom API, insert into `manual_conversations` + `manual_messages`
- Sets `created_at` to first message timestamp
- Returns results per ID (imported/skipped/failed)

### Modified files

**`src/App.tsx`**
- Add route `/import/bulk` pointing to `BulkImportReview`

**`src/components/ImportTab.tsx`**
- Add a link/button "Bulk import from CSV" that navigates to `/import/bulk`

**`src/pages/FlowDiagram.tsx`**
- Add node for bulk import review flow

### Duplicate detection logic (client-side)

```text
For each CSV row:
  1. Check intercom_conversation_id exact match across all 3 tables → "Tracked"
  2. Normalize subject → check fuzzy match (substring/includes) against subjects → "Possible duplicate"  
  3. Check user email against from_email / contact_name → if subject also partially matches → "Possible duplicate"
  4. Otherwise → "Missing"
```

### Technical notes
- CSV parsing done client-side (no server round-trip for file reading)
- All existing conversations fetched once on page load for comparison
- The bulk import edge function reuses the same Intercom API logic from `import-intercom-ticket` (fetch conversation, paginate parts, extract messages, strip HTML)
- Rate limiting: 200ms delay between Intercom API calls
- Owner auto-set from CSV column "Teammate currently assigned"

