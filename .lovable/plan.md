

## Redesign conversation detail page with 70/30 split layout

### What changes
The current single-column layout (max-w-3xl centered) becomes a two-panel layout: 70% left for the conversation content (channel info, sender, thread messages) and 30% right sidebar for metadata and actions.

### Left panel (70%) — conversation content
- **Header row**: Channel name, sent by, and basic info (subject for Gmail/Manual)
- **Thread/messages card**: The full threaded conversation (Slack thread, Gmail snippet, or manual messages) — this is the primary focus area and takes up most vertical space

### Right panel (30%) — metadata sidebar
- **Status section**: ID badge, status dropdown, source badge, test toggle
- **Classification section**: Classification dropdown, incident toggle, product area, owner
- **Links section**: Slack thread / Gmail / Intercom buttons, create Intercom ticket
- **Dates section**: Created, updated, resolved, reminder sent
- **Raw IDs**: Collapsible section (Slack only)

### Technical approach

**`src/pages/ConversationDetail.tsx`**
- Replace `max-w-3xl` centered container with a flex row: `flex gap-6`
- Left div: `w-[70%]` containing the details card (channel/sender) and thread card
- Right div: `w-[30%]` containing status card, classification card, links card, dates card, raw IDs
- Right panel uses `sticky top-6` so it stays visible while scrolling the thread
- Responsive: on small screens, stack vertically (flex-col)

**`src/pages/FlowDiagram.tsx`**
- Update navigation notes for the layout change

### Files to edit
- `src/pages/ConversationDetail.tsx`
- `src/pages/FlowDiagram.tsx`

