

## Add Row Number / Conversation ID Column to Conversations Table

### Change

**File: `src/pages/Conversations.tsx`**

Add a "#" column as the first column in the table that displays a sequential row number (based on position in the list, starting from 1). This gives each conversation a simple reference number visible in the UI.

Alternatively, we could show the first 8 characters of the UUID `id` field as a short ID (e.g., `a3f2b1c9`). 

The row number approach is simpler but changes when filters/pagination shift. The short UUID is stable and can be used to reference a specific record.

**Recommendation:** Show the short UUID (`id.slice(0, 8)`) in a monospace font — it's stable, unique, and copyable.

### Details

- Add `<TableHead>#</TableHead>` as the first column header
- Add a `<TableCell>` showing `m.id.slice(0, 8)` with monospace styling and a click-to-copy tooltip
- No database changes needed — the `id` field already exists

