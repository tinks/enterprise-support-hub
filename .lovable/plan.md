# Add Tine as a new owner

Add "Tine" to every place an owner can be selected, attributed, or filtered. The sidebar dashboard entry for Tine already exists (`/my/tine` in `AppLayout.tsx`), so no sidebar change is needed.

## Changes

1. **`src/pages/Conversations.tsx`**
   - Extend `OwnerFilter` type to include `"Tine"`.
   - Append `"Tine"` to `OWNER_OPTIONS`. (All four dropdowns and the bulk-edit popover read from this constant, so they pick it up automatically.)

2. **`src/pages/ConversationDetail.tsx`**
   - Append `"Tine"` to `OWNER_OPTIONS` so the per-conversation owner dropdown offers Tine.

3. **`src/pages/TestChannelReview.tsx`**
   - Add `<SelectItem value="Tine">Tine</SelectItem>` next to the existing owner items.

4. **`src/pages/BulkImportReview.tsx`**
   - Add `tine: "Tine"` to `OWNER_MAP` so CSV/Intercom name matching resolves to Tine.

5. **`src/lib/parseThread.ts`**
   - Add `{ name: "Tine" }` to `ADMIN_OPTIONS` (no Slack ID or email yet — both are optional).

6. **`.lovable/memory/team/owners.md`**
   - Add Tine to the canonical owner list. Note that Slack ID, email, and Intercom admin ID are not yet known.

## Not changing

- `src/components/AppLayout.tsx` — Tine is already in `dashboardItems`, so `/my/tine` is already routed via `OwnerDashboard.tsx`.
- Settings → Admin owner mapping (`settings.admin_owner_map`) — only needed once Tine's Intercom admin ID is known. Will flag this as a follow-up.
- No database migration: `owner` is a free-text column, so existing rows are untouched and new selections persist immediately.

## Follow-up to ask the user after merging

- Tine's Slack user ID (for accurate Slack attribution in `parseThread.ts`).
- Tine's email (for ADMIN_OPTIONS).
- Tine's Intercom admin ID (to enable auto-assignment via `settings.admin_owner_map`).
