
Fix this locally in the Conversations page instead of changing the global app layout again.

What is happening now
- The page-level content area is still the thing that scrolls.
- The table also has its own wrapper with `overflow-auto`, but it is not height-constrained, so it does not become the real scrolling viewport.
- Because of that, the headers are not behaving like a fixed row above a scrolling body.

Plan

1. Make the Conversations page fill the available height
- In `src/pages/Conversations.tsx`, change the page wrappers to `h-full min-h-0 flex flex-col`
- Make the main `Card` a full-height flex column: `flex min-h-0 flex-1 flex-col`
- Make `CardContent` the same: `flex min-h-0 flex-1 flex-col overflow-hidden`

2. Create one dedicated scroll area only for the table body section
- Wrap the table in a container like `div className="min-h-0 flex-1 overflow-auto"`
- This becomes the scrollable region directly under the headers, so the rows scroll inside the card instead of the full page scrolling

3. Remove the competing table scroll wrapper
- In `src/components/ui/table.tsx`, stop hardcoding `overflow-auto` on the internal wrapper, or make it configurable
- Let `Conversations.tsx` own the scroll container so there is only one active scrolling layer

4. Make the column headers sticky inside that scroll area
- Keep the sticky behavior on the table header, but if needed move the sticky classes to each `TableHead` for more reliable behavior:
  - `sticky top-0 z-20 bg-card`
- Add a border/background so the header row stays visually solid while rows move underneath it

5. Keep the rest of the page static
- Filters, title, and card header remain above the scroll area
- Only the rows below `# / Source / Sent by / Message / Subject / Channel / Link / ...` should move

6. Update the Flow page
- In `src/pages/FlowDiagram.tsx`, add a brief note that the Conversations view now uses an internal scroll region with sticky column headers

Files to edit
- `src/pages/Conversations.tsx`
- `src/components/ui/table.tsx`
- `src/pages/FlowDiagram.tsx`

Expected result
- The page itself no longer feels like the thing scrolling on Conversations
- The conversation rows scroll inside the card
- The column headers stay visible while you scroll through the list
