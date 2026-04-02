

## Add "Slack DM/Private chat" source option to log conversation

### What it does
Adds a new source option "Slack DM/Private chat" to the Source dropdown in the manual log conversation form, alongside the existing Teams, Phone, and Other options.

### Changes

**`src/components/ManualLogTab.tsx`**
- Add a new `<SelectItem value="slack_dm">Slack DM/Private chat</SelectItem>` to the source dropdown (after the existing Teams/Phone/Other options).

**`src/pages/FlowDiagram.tsx`** — Document the new source option.

### Files to edit
- `src/components/ManualLogTab.tsx`
- `src/pages/FlowDiagram.tsx`

