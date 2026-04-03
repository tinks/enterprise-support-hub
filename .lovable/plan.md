

## Update project knowledge file to reflect current state

### What's missing or outdated

1. **UI Pages table (lines 34-40)** is stale:
   - `/` is Stats, not Settings
   - `/settings` is Settings (was `/`)
   - Missing routes: `/import` (Import), `/knowledge` (Knowledge), `/my/:owner` (Owner Dashboard)

2. **Database tables (lines 27-32)** missing `knowledge_documents`

3. **No section on navigation layout** — the sidebar, Dashboards flyout, controlled tooltips, and portal-based submenu are all undocumented

### Changes

**`.lovable/project-knowledge.md`**

1. Update the **UI Pages** table to match current routes:

| Route | Page | Purpose |
|---|---|---|
| `/` | Stats | System statistics |
| `/conversations` | Conversations | View and monitor active/resolved conversations |
| `/conversations/:id` | Conversation detail | Individual conversation thread view |
| `/my/:owner` | Owner dashboard | Per-person dashboard (Joel, Kristina) |
| `/import` | Import | Import conversations from external sources |
| `/settings` | Settings | Configure channels, Intercom IDs, testing mode, view webhook URLs |
| `/flow` | Flow diagram | Interactive visual diagram of the full support workflow |
| `/knowledge` | Knowledge | View and edit project knowledge document |

2. Add `knowledge_documents` to the **Database Tables** section.

3. Add a new **Section 19: Navigation layout** documenting:
   - Collapsible left sidebar (56px collapsed → 200px expanded on hover)
   - 2px vertical gradient accent on left edge
   - Controlled tooltip state: only one tooltip visible at a time when collapsed, using `activeTooltip` state
   - Dashboards flyout group: Joel and Kristina appear in a hover-driven portal-rendered flyout menu
   - Flyout uses 150ms debounce so the menu stays mounted while the mouse crosses from trigger to submenu
   - `overflow-hidden` on all nav rows to prevent label text leaking when collapsed
   - Label visibility uses `max-w-0`/`max-w-[150px]` + opacity transition

### Files to edit
- `.lovable/project-knowledge.md`

