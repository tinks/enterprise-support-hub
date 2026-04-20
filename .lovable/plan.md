

## Make manual Slack imports behave like normal Slack conversations in the inbox

### What I found
- The inbox search is not id-only. The database search already matches manual conversations by:
  - `contact_name`
  - `subject`
  - `status`
  - `owner`
  - `classification`
  - `link`
  - `manual_messages.message_text`
- The real mismatch is presentation and filtering behavior for manual Slack imports:
  - In `Conversations.tsx`, manual rows show `mc.source` in the **Channel** column instead of the Slack channel name from `link`.
  - The **Link** column treats `mc.link` as a URL, but for manual Slack imports it contains channel text like `ext_lovable-control-tower`, not a real URL.
  - So manual Slack imports are not visually “treated like normal convos,” which makes search/drilldown look broken even when rows exist.
- The analytics bar count of 10 is consistent with the current time range filter (“This month”). The database still has 14 canonical `ext_lovable-control-tower` rows total.

### Plan

**1. Update inbox rendering so manual Slack imports display as Slack channels**
- In `src/pages/Conversations.tsx`, change manual row rendering:
  - If `mc.source === "slack_thread"`:
    - **Channel** column should display `#${normalizeChannelName(mc.link)}` (or `#unknown` if empty), with the same `Hash`-style treatment as Slack rows.
    - **Link** column should no longer render `mc.link` as an external URL.
  - If `mc.source === "slack_dm"`:
    - **Channel** column should display `Direct message`.
    - **Link** column should stay empty unless there is an actual external link.
  - Non-Slack manual entries can keep the current behavior.
- This makes manual Slack imports readable and searchable by humans in the same way as normal Slack conversations.

**2. Make manual drilldown rows easier to find and verify**
- Keep the existing `manualChannel` query param filter, but improve the inbox view so the filtered rows visibly show the matching channel.
- Update the empty state in `src/pages/Conversations.tsx`:
  - When `manualChannel` is active, say the channel being filtered and suggest clearing other filters if no rows match.
- This will make it clear whether the issue is “no matching rows” or “rows exist but other filters are narrowing them.”

**3. Improve search UX for manual Slack imports**
- Since server-side search already covers `manual_conversations.link`, no backend search rewrite is needed unless testing shows a real miss.
- Instead, improve the inbox search experience in `src/pages/Conversations.tsx` by:
  - making manual Slack rows visibly expose their channel name in the table
  - optionally adjusting the search placeholder/help text to indicate users can search by channel name, subject, sender, or message text
- If testing shows channel-name searches still miss rows, then add a follow-up migration/function update; for this pass, the primary fix is the inbox rendering mismatch.

**4. Clarify analytics count behavior**
- In `src/pages/Stats.tsx`, add a small note near the “Conversations by channel” chart or subtitle that channel counts respect the selected date range.
- No change to the default date range is needed.
- This prevents confusion like “there are 14 in the DB but only 10 in the bar.”

**5. Update the flow page and knowledge docs**
- Update `.lovable/project-knowledge.md` to document:
  - manual Slack imports use `manual_conversations.link` as the channel name
  - manual Slack rows now display channel names in the inbox channel column instead of raw source labels
  - search already includes `manual_conversations.link` and `manual_messages.message_text`
  - analytics channel counts respect the active date range
- Update `src/pages/FlowDiagram.tsx` comment block with the same logic change summary so the flow page stays current.

### Files
- Edit: `src/pages/Conversations.tsx`
- Edit: `src/pages/Stats.tsx`
- Edit: `src/pages/FlowDiagram.tsx`
- Edit: `.lovable/project-knowledge.md`

### Out of scope
- Changing the default analytics range from “This month”
- Merging manual and auto-tracked Slack bars with identical display names
- Reworking the database search function unless manual channel-name searches still fail after the inbox rendering fix

