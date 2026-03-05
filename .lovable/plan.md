

# Add Stats Dashboard and Flow Diagram Pages

## Overview
Add two new pages with tab-based navigation across the app:
1. **Stats page** — query `conversation_mappings` to show total messages, resolved/escalated counts, and thumbs up/down ratios
2. **Flow Diagram page** — static visual showing the program logic for teammates

## Changes

### 1. Navigation layout component
- Create `src/components/AppLayout.tsx` with a simple top nav bar linking to `/` (Settings), `/stats` (Stats), and `/flow` (Flow Diagram)
- Wrap all page content with this layout

### 2. Stats page (`src/pages/Stats.tsx`)
- Query `conversation_mappings` table, counting by `status`:
  - **Total messages**: all rows
  - **Resolved** (thumbs up): `status = 'resolved'`
  - **Escalated** (thumbs down): `status = 'escalated'`
  - **Active/Pending**: `status = 'active'` or `status = 'awaiting_context'`
- Display summary cards with counts and ratios
- Add a bar chart (using recharts) showing resolved vs escalated over time (grouped by day)
- Add a pie chart for status distribution

### 3. Flow Diagram page (`src/pages/FlowDiagram.tsx`)
- Static page with a clear visual representation of the bot's logic flow using styled cards/arrows or an SVG diagram
- Sections covering:
  1. User @mentions bot in Slack
  2. Bot posts buttons (Add Details / Proceed)
  3. Button click routes to slack-interactions
  4. Intercom ticket created
  5. AI responds via Intercom webhook back to Slack
  6. Feedback buttons (thumbs up closes, thumbs down escalates)

### 4. Update `App.tsx`
- Add routes for `/stats` and `/flow`
- Import new pages

### 5. Update `Index.tsx`
- Wrap content with `AppLayout`

