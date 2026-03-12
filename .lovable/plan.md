

## Updated Program Flow Page

Redesign `src/pages/FlowDiagram.tsx` to show the full detailed flow with actual messages, branching paths, and all edge cases. Replace the current linear card layout with a structured flow that branches at decision points.

### Structure

The page will use a tree-like layout with:
1. **Main trunk** (steps 1-5): Linear flow from mention to AI response
2. **Branch at step 3**: "Add Details" (modal) vs "Proceed" (skip)
3. **Branch at step 5**: After AI responds, user can click feedback buttons
4. **Branch at step 6**: Positive (resolve) vs Negative (escalate)
5. **Sub-flow after escalation**: Human replies from Slack forwarded to Intercom, human replies from Intercom posted back to Slack

### Detailed steps with actual messages

1. **User @mentions bot** in monitored channel
   - Bot receives via `slack-events`
   - Checks if channel is monitored, deduplicates via `conversation_mappings`
   - If thread reply, fetches full thread transcript

2. **Bot posts prompt** with two buttons
   - Message: "Optionally add your Lovable account email and/or project link..."
   - Buttons: "Add Details" (primary) | "Proceed"
   - Status saved as `awaiting_context`

3a. **"Add Details" clicked** → `slack-interactions`
   - Prompt message deleted
   - Modal opens with Email + Project Link fields
   - On submit → creates Intercom ticket

3b. **"Proceed" clicked** → `slack-interactions`
   - Prompt message deleted
   - Creates Intercom ticket immediately (no extra context)

4. **Intercom ticket creation** (shared path)
   - Adds 👀 reaction to original message
   - Posts: "Thanks! Generating a response... Should take about 3-4 minutes."
   - Searches/creates Intercom contact (by email or external_id)
   - Creates conversation, assigns to AI agent, tags with "Slack"
   - Updates mapping: status → `active`

5. **AI responds** → `intercom-webhook`
   - Removes old feedback buttons from thread
   - Posts reply chunks to Slack thread (with admin name/avatar)
   - Appends feedback buttons to last chunk:
     - "This resolved my issue" | "Escalate to human"

6a. **Positive feedback** → `slack-interactions`
   - Removes buttons, removes 👀 and ⏳, adds ✅
   - Posts: "Glad that helped! Marking as resolved."
   - Reassigns to team inbox, closes Intercom conversation
   - Status → `resolved`

6b. **Negative feedback** → `slack-interactions`
   - Removes buttons, removes 👀, adds ⏳
   - Posts: "Escalating to human support..."
   - Reassigns to team inbox
   - Status → `escalated`

6b-i. **Human replies in Slack thread** → `slack-events`
   - Forwards message to Intercom as the contact
   - Removes any remaining feedback buttons
   - First reply only: reassigns to team inbox, posts escalation notice

6b-ii. **Human replies from Intercom** → `intercom-webhook`
   - Removes old feedback buttons
   - Posts reply to Slack with admin identity
   - Shows "This resolved my issue" button (no escalate button since already escalated)

7. **Conversation closed in Intercom** → `intercom-webhook`
   - Removes all feedback buttons
   - Posts: "This issue has been marked as resolved..."
   - Removes 👀 and ⏳, adds ✅
   - Status → `resolved`

### Implementation

- Rewrite `FlowDiagram.tsx` with a visual tree layout
- Use indented/nested cards for branches (with connecting lines via CSS borders)
- Show actual Slack messages in `font-mono` code-style blocks
- Color-code: green for resolved paths, orange for escalation, blue for main flow
- Use collapsible sections for the sub-flows after escalation
- Include emoji indicators (👀 ⏳ ✅) inline to show reaction lifecycle
- Keep the Edge Functions reference card at the bottom

### Visual layout sketch

```text
[1. @mention in Slack]
        |
[2. Bot posts prompt with buttons]
        |
   ┌────┴────┐
   |         |
[3a. Add   [3b. Proceed]
 Details]    |
   |         |
   └────┬────┘
        |
[4. Intercom ticket created, 👀 added]
        |
[5. AI responds → posted to Slack with feedback buttons]
        |
   ┌────┴────┐
   |         |
[6a. 👍    [6b. 👎 Escalate]
 Resolved]   |
   |    ┌────┴────┐
   |    |         |
  ✅  [6b-i.    [6b-ii.
       Human     Intercom
       replies   replies]
       in Slack]  |
        |         |
        └────┬────┘
             |
      [7. Closed in Intercom → ✅]
```

