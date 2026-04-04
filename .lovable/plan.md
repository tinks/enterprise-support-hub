

## Add "Select all" options to Source and Owner dropdowns

### What changes
The "all" option in both the Source and Owner filter dropdowns currently shows just "Source" / "Owner". Rename these to "Select all" so users clearly understand it resets the filter to show everything.

### Implementation

**`src/pages/Conversations.tsx`**
- Change `<SelectItem value="all">Source</SelectItem>` to `<SelectItem value="all">Select all</SelectItem>`
- Change `<SelectItem value="all">Owner</SelectItem>` to `<SelectItem value="all">Select all</SelectItem>`
- Update the `<SelectValue placeholder="...">` for each to use "Source" and "Owner" respectively, so the trigger still shows a meaningful label when "all" is selected

### Files to edit
- `src/pages/Conversations.tsx`

