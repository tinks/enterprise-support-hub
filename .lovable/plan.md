## Goal

Track Eren's SSO/SCIM contractor work inside the existing Inbox — no separate tables, no separate page. Eren becomes a regular owner alongside Joel, Kristina, Sam, and CSM.

## Why this fits

The system already models "who is handling a ticket" as a free-text `owner` column on `conversation_mappings`, `gmail_conversations`, and `manual_conversations`. Owner is also auto-resolved from Intercom assignment events via the `admin_owner_map` in settings (Intercom admin ID → owner name). All analytics, filters, and dashboards read from that one column. Adding Eren as an owner means his work shows up in:

- Inbox owner filter and per-row owner dropdown
- Stats "Conversations by owner" chart
- Sidebar "My" dashboard (`/my/eren`)
- Conversation detail owner picker
- Bulk import owner mapping
- Auto-assignment from Intercom (once his admin ID is mapped)

Filtering by `Owner = Eren` + `Product area = SSO` or `SCIM` gives you a clean view of just his work without isolating it from the rest.

## Changes

### 1. Add Eren to the hardcoded owner option lists

Four files reference the closed list `["Joel", "Kristina", "Sam", "CSM"]`. Add `"Eren"` to each:

- `src/pages/Conversations.tsx` — `OwnerFilter` type and `OWNER_OPTIONS`
- `src/pages/ConversationDetail.tsx` — `OWNER_OPTIONS`
- `src/pages/TestChannelReview.tsx` — `<SelectItem>` list
- `src/pages/BulkImportReview.tsx` — `mapOwner` lookup table (add `"eren": "Eren"` and any name variants)

### 2. Add Eren to the sidebar "My" dashboards

`src/components/AppLayout.tsx` — append `{ to: "/my/eren", label: "Eren" }` next to Joel and Kristina. The `/my/:owner` route already renders generically via `OwnerDashboard.tsx`, so no new page needed.

### 3. Map Eren's Intercom admin ID for auto-owner assignment

This is a runtime configuration step, not a code change. After Eren is added as an Intercom teammate:

- Open Settings → Admin → owner mapping card
- Add a row: `{Eren's Intercom admin ID} → Eren`
- Save

From then on, any Intercom conversation assigned to Eren is auto-tagged `owner = Eren` by `intercom-webhook` and `poll-intercom-inbox` — same path Joel and Kristina already use.

### 4. (Optional) Pre-populate SSO/SCIM scope

Confirm `SSO` and `SCIM` already exist in `settings.product_areas` (default seed includes both). Nothing to change unless they were removed.

### 5. Documentation

Update `.lovable/project-knowledge.md` and the Flow page owner-list comments to mention Eren as a contractor owner for SSO/SCIM. Add a memory note recording that Eren is a contractor scoped to SSO/SCIM.

## Why not separate tracking

- A separate table or page would fork analytics, audit logs, status automation, owner auto-assignment, and the Intercom/Slack/Gmail dedup logic — all of which currently key off the unified `owner` field.
- "Contractor vs. employee" is a property of the person, not the ticket. If you later want to distinguish them in reports, the cleaner add-on is a small `owner_metadata` table (`owner_name`, `role`, `active`) — but that's only worth doing if you hire more contractors. For one person, the owner string is enough.

## Out of scope

- Building a contractor-vs-employee toggle or separate role table (revisit if you add more contractors).
- Restricting Eren's RLS access — current auth model treats all signed-in teammates equally; changing that is a much larger task.
- Auto-routing SSO/SCIM tickets to Eren in Intercom (would need a workflow rule on Intercom's side, not in this app).
