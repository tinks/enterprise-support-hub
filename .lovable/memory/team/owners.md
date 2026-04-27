---
name: Owners
description: Canonical owner list, contractor scope, and how to add new owners
type: feature
---
Canonical owner options across UI: Joel, Kristina, Sam (AI agent), CSM, Eren.

Known teammate emails (recorded in `src/lib/parseThread.ts` `ADMIN_OPTIONS`): Eren = `eren@lovable.dev`. Slack user ID and Intercom admin ID for Eren are not yet known.

Eren is a contractor scoped to SSO/SCIM work. Tracked in the unified Inbox like any other owner — filter by `Owner = Eren` (optionally combined with `Product area = SSO` or `SCIM`) to see his work. No separate tables, page, or analytics path.

To add a new owner:
1. Append to `OWNER_OPTIONS` in `src/pages/Conversations.tsx` (also extend `OwnerFilter` type), `src/pages/ConversationDetail.tsx`, and the SelectItem list in `src/pages/TestChannelReview.tsx`.
2. Add to `OWNER_MAP` in `src/pages/BulkImportReview.tsx` (lowercase name → display name).
3. Add a sidebar entry in `src/components/AppLayout.tsx` `dashboardItems` (route `/my/<lowercase>` is auto-rendered by `OwnerDashboard.tsx`).
4. For Intercom auto-assignment, add their Intercom admin ID → owner name in Settings → Admin → owner mapping (`settings.admin_owner_map`). Read by `intercom-webhook` and `poll-intercom-inbox`.
