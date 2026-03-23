

## Widen Conversations Table and Make Message Expandable

### Changes

1. **Widen the container** — Change `max-w-5xl` to `max-w-7xl` on line 101 so the table has more horizontal space.

2. **Make message preview expandable** — Replace the static truncated text with a clickable element. Clicking it toggles between the truncated preview (60 chars) and the full message text. Use local state (`expandedMessages: Set<string>`) to track which rows are expanded.

### Technical Details

**File: `src/pages/Conversations.tsx`**

- Add state: `const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set())`
- Add toggle function that adds/removes IDs from the set
- Line 101: `max-w-5xl` → `max-w-7xl`
- Lines 143-151: Replace the truncated span with a clickable `button` that shows full text when expanded, truncated + "…" when collapsed. Remove `truncate` class when expanded, keep `max-w-[300px]` base width.

