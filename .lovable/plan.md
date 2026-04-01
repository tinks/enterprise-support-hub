

## Add admin identity selection to manual log

### What changes
In the manual log message builder, when the role is "admin", replace the free-text sender name with a dropdown that lets you pick either Joel Samuelson or Kristina Bodurova. Their Slack user IDs are stored alongside.

### Details

**`src/components/ManualLogTab.tsx`**

1. Add a constant mapping the two admins:
   ```ts
   const ADMIN_OPTIONS = [
     { name: "Joel Samuelson", slackId: "U091GANMA2U" },
     { name: "Kristina Bodurova", slackId: "U0AFU714807" },
   ];
   ```

2. When a message's role is "admin", replace the free-text sender name `Input` with a `Select` dropdown showing "Joel Samuelson" and "Kristina Bodurova". The selected value sets `sender_name` to the admin's name.

3. When switching role from "user" to "admin", auto-clear the sender name so the user picks from the dropdown. When switching from "admin" to "user", clear it back to free text.

4. No database changes needed — `sender_name` already stores the name as text.

**`src/pages/FlowDiagram.tsx`** — Document that admin messages in manual log use a fixed dropdown for Joel/Kristina.

### Files to edit
- `src/components/ManualLogTab.tsx`
- `src/pages/FlowDiagram.tsx`

