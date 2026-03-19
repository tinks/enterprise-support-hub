

## Add Channel Filter to Conversations Page

### What Changes

Add clickable channel filter badges between the card header and the table, matching the pattern already used on the Stats page. When no channels are selected, all conversations show. Clicking a badge toggles that channel on/off.

### Technical Details

**File: `src/pages/Conversations.tsx`**

1. Add state: `selectedChannels: string[]` (default empty = show all)
2. Derive `availableChannels` from mappings — unique channel IDs with resolved names, sorted alphabetically
3. Compute `filteredMappings` — if `selectedChannels` is empty show all, otherwise filter to selected
4. Render filter badges row between `CardHeader` and the table inside `CardContent`
5. Use `filteredMappings` instead of `mappings` in the table body

